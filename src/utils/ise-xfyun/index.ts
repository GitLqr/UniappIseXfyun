import { Base64 } from "js-base64";
import { XMLParser } from "fast-xml-parser";
import CryptoES from "crypto-es";

/**
 * 科大讯飞 语音评测（流式版）封装
 *
 * 注意：需要设置wss域名白名单 wss://ise-api.xfyun.cn
 * 建议：apiKey、apiSecret 不要存放在本地，应该放在后端，防止被破解。
 * 最佳做法：继承 IseXfyun，重写 getWebSocketUrl()，从后端获取 socket 链接，即 webSocketUrl 的计算规则由后端实现。
 *
 * @author GitLqr
 * @since 2022-08-30
 */
export default class IseXfyun {
  private isLogEnable = false;
  private isRunning = false;
  private isFirstFrameSend = false; // 第一帧是否已经发送
  private aue = () => (this.format === "pcm" ? "raw" : "lame");
  private audioDataList: ArrayBuffer[] = []; // 音频流数据
  /* socket相关 */
  private socketTask: UniApp.SocketTask | null = null;
  private handlerInterval: number | null = null;

  /**
   * @param chapter 要对比的文字内容
   * @param category 语音评测类型。（如：read_chapter read_syllable/单字朗读，汉语专有 read_word/词语朗读  read_sentence/句子朗读。具体参考 https://www.xfyun.cn/doc/Ise/IseAPI.html#接口调用流程）
   * @param callback
   * @param appId 科大讯飞 APPID（必填）
   * @param apiKey 科大讯飞 API_KEY（继承重写 getWebSocketUrl() 的话，可不填写）
   * @param apiSecret 科大讯飞 API_SECRET（继承重写 getWebSocketUrl() 的话，可不填写）
   */
  constructor(
    public chapter: string,
    public category: string,
    protected callback: IseXfyunCallback,
    protected appId: string,
    protected apiKey: string = "",
    protected apiSecret: string = "",
    protected ent: "cn_vip" | "en_vip" = "cn_vip", // 中文：cn_vip 英文：en_vip
    protected format: "pcm" | "mp3" = "mp3"
  ) {
    if (chapter === "") throw new Error("chapter must not be empty");
    if (appId === "") throw new Error("appId must not be empty");
  }

  /**
   * 科大讯飞的语音评测只支持 16k 16bit 单通道
   * 参数配置参考：
   * https://developers.weixin.qq.com/miniprogram/dev/api/media/recorder/RecorderManager.start.html
   * https://cloud.tencent.com/document/product/884/33984
   * @param duration 录音时长
   * @returns 录音配置
   */
  getAudioRecordOption(duration: number) {
    return {
      duration: duration, // 录音的时长，单位 ms，最大值 600000（10 分钟）
      sampleRate: 16000, // 采样率（pc不支持）
      numberOfChannels: 1, // 录音通道数
      // encodeBitRate: 48000, // 编码码率(默认就是48000)
      frameSize: 1, // 指定帧大小，单位 KB。传入 frameSize 后，每录制指定帧大小的内容后，会回调录制的文件内容，不指定则不会回调。暂仅支持 mp3、pcm 格式。
      format: this.format, // 音频格式，默认是 aac
    };
  }

  /**
   * 进入开始状态
   */
  start() {
    this.isFirstFrameSend = false;
    this.connect();
  }

  /**
   * 进入退出状态
   * 注意：
   * 1、此方法是为了让 sendAudioData() 中知道，此时以后，若再出现 audioDataList 为空，则是真正的最后一帧。
   * 2、此方法不会触发断开 ws ，ws 断开与否由 onMessage() 中控制。
   */
  stop() {
    this.isRunning = false;
  }

  /**
   * 添加语音数据
   * @param frameBuffer 帧数据
   */
  pushAudioData(frameBuffer: any) {
    if (this.isRunning && frameBuffer) {
      this.audioDataList.push(frameBuffer);
    }
  }

  /**
   * @returns 生成wss链接
   */
  protected getWebSocketUrl(): Promise<string> {
    if (this.apiKey === "" || this.apiSecret === "") {
      throw new Error("apiKey、apiSecret must not be empty !!!");
    }
    return new Promise<string>((resolve, reject) => {
      // 请求地址根据语种不同变化
      let url = "wss://ise-api.xfyun.cn/v2/open-ise";
      const host = "ise-api.xfyun.cn";
      /**
       * 注意: 直接使用 new Date().toGMTString() 会报错，可以在 src/env.d.ts 中进行如下声明解决:
       *       interface Date { toGMTString(): string; }
       * 方案来源：[fix: Property 'toGMTString' does not exist on type 'Date'](https://github.com/microsoft/TypeScript/issues/13622)
       * 这里为了方便直接强转 any 处理了~
       */
      const date = (new Date() as any).toGMTString();
      const algorithm = "hmac-sha256";
      const headers = "host date request-line";
      const signatureOrigin = `host: ${host}\ndate: ${date}\nGET /v2/open-ise HTTP/1.1`;
      const signatureSha = CryptoES.HmacSHA256(signatureOrigin, this.apiSecret);
      const signature = CryptoES.enc.Base64.stringify(signatureSha);
      const authorizationOrigin = `api_key="${this.apiKey}", algorithm="${algorithm}", headers="${headers}", signature="${signature}"`;
      const authorization = Base64.encode(authorizationOrigin);
      url = `${url}?authorization=${authorization}&date=${date}&host=${host}`;
      resolve(url);
    });
  }

  /**
   * 连接科大讯飞wss接口
   */
  async connect() {
    const url = await this.getWebSocketUrl();
    const newUrl = encodeURI(url);
    this.socketTask = uni.connectSocket({
      url: newUrl,
      // 如果希望返回一个 socketTask 对象，需要至少传入 success / fail / complete 参数中的一个
      complete: () => {},
    });
    this.socketTask.onOpen((res) => {
      this.log("socket open: ", res);
      this.isRunning = true;
      this.callback.onOpen();
      setTimeout(() => {
        this.sendAudioData();
      }, 500);
    });
    this.socketTask.onMessage((res) => {
      this.onMessage(res.data.toString());
    });
    this.socketTask.onError((err) => {
      this.socketTask = null;
      this.log("socket err: ", err);
      this.isRunning = false;
      this.callback.onError(err);
    });
    this.socketTask.onClose(() => {
      this.socketTask = null;
      this.log("socket close");
      this.isRunning = false;
      this.callback.onClose();
    });
  }

  /**
   * 断开连接
   */
  disconnect() {
    this.socketTask?.close({});
    this.socketTask = null;
  }

  /**
   * 开启日志
   */
  enableLog() {
    this.isLogEnable = true;
  }

  /**
   * 关闭日志
   */
  disableLog() {
    this.isLogEnable = false;
  }

  /**
   * 发送语音数据
   */
  private sendAudioData() {
    if (!this.socketTask) {
      this.log("socketTask 为 null， 无法发送数据");
      return;
    }
    const params = {
      common: {
        app_id: this.appId,
      },
      business: {
        aue: this.aue(),
        auf: "audio/L16;rate=16000",
        category: this.category,
        cmd: "ssb",
        ent: this.ent,
        sub: "ise",
        text: "\uFEFF" + this.chapter,
        ttp_skip: true,
        rstcd: "utf8",
        group: "pupil",
        tte: "utf-8",
      },
      data: {
        status: 0,
      },
    };
    this.log("发送ws数据：", JSON.stringify(params));
    this.socketTask.send({ data: JSON.stringify(params) });

    this.handlerInterval = setInterval(() => {
      // websocket未连接
      if (!this.socketTask) {
        return this.clearHandlerInterval();
      }
      // 最后一帧
      if (this.audioDataList.length === 0) {
        // 可能是数据消费太快（mp3是压缩格式，积攒到一定量才能拿到数据，这段时间可能比较久），这里需要确认是否真的是最后一帧
        if (this.isRunning) {
          this.log(`${this.format}数据暂时未能及时填充，不是最后一帧`);
          return;
        }
        const params = {
          business: {
            cmd: "auw",
            aus: 4,
            aue: this.aue(),
          },
          data: {
            status: 2,
            data: "",
          },
        };
        this.log("ws数据发送最后一帧: ", JSON.stringify(params));
        this.socketTask.send({ data: JSON.stringify(params) });
        this.audioDataList = [];
        return this.clearHandlerInterval();
      }
      // 中间帧(aus:2) 或 第一帧(aus:1)
      const audioData = this.audioDataList.splice(0, 1);
      if (audioData && audioData[0]) {
        const params = {
          business: {
            cmd: "auw",
            aus: this.isFirstFrameSend ? 2 : 1,
            aue: this.aue(),
          },
          data: {
            status: 1,
            data: this.toBase64(audioData[0]),
          },
        };
        this.log(
          `ws数据发送${this.isFirstFrameSend ? "中间帧" : "第一帧"}: `,
          JSON.stringify(params)
        );
        this.socketTask.send({ data: JSON.stringify(params) });
        this.isFirstFrameSend = true;
      }
    }, 40);
  }

  private onMessage(resultData: string) {
    const jsonData = JSON.parse(resultData);
    this.log("收到消息：", jsonData);
    if (jsonData.data && jsonData.data.data) {
      const data = Base64.decode(jsonData.data.data);
      const parser = new XMLParser({
        attributeNamePrefix: "",
        ignoreAttributes: false,
        allowBooleanAttributes: true,
      });
      const grade = parser.parse(data);
      this.callback.onResult(grade.xml_result);
    }
    if (jsonData.code === 0 && jsonData.data.status === 2) {
      this.disconnect();
    }
    if (jsonData.code !== 0) {
      this.callback.onError(jsonData);
      this.log(`${jsonData.code}:${jsonData.message}`);
      this.disconnect();
    }
  }

  private toBase64(buffer: ArrayBuffer) {
    // 重点：使用 wx.arrayBufferToBase64() 产出的 base64 可被科大讯飞识别，而科大讯飞的jsdemo里的 toBase64() 会出现 68675 错误码。
    // https://www.xfyun.cn/doc/Ise/IseAPI.html#错误码
    return uni.arrayBufferToBase64(buffer);
  }

  private clearHandlerInterval() {
    if (this.handlerInterval) {
      clearInterval(this.handlerInterval);
      this.handlerInterval = null;
    }
  }

  protected log(...args: any) {
    if (this.isLogEnable) {
      console.log("【IseXfyun】", ...args);
    }
  }
}
