<template>
  <view class="content">
    <text>{{ chapter }}</text>
    <button @click="onRecordBtnClick">
      {{ isRecording ? "暂停录音" : "开始录音" }}
    </button>
    <text>{{ grade }}</text>
  </view>
</template>

<script setup lang="ts">
import IseXfyun from "@/utils/ise-xfyun";
import { ref } from "vue";

/* 题型相关 */
const chapter = "欢迎关注全栈行动公众号";
const category = "read_sentence";
// const chapter = "白日依山尽，黄河入海流。欲穷千里目，更上一层楼。";
// const category = "read_chapter";
const grade = ref(""); // 成绩

/* 录音相关 */
const recordManager = uni.getRecorderManager();
const duration = 180000; // 录音时长（注意：最长不能超过5分钟）
const isRecording = ref(false); // 是否正在录音

/* 科大讯飞相关 */
const callback: IseXfyunCallback = {
  onOpen: () => {},
  onClose: () => stopRecord(),
  onError: (err) => stopRecord(),
  onResult: (result: any) => {
    console.log("成绩：", result);
    // accuracy_score：准确度
    // emotion_score：整体印象分（朗读是否清晰流畅，是否富有感情等）
    // fluency_score：流畅度分
    // integrity_score：完整度分
    // phone_score：声韵分
    // tone_score：调型分
    // total_score：总分【总分 = 准确度分*0.4 + 流畅度分*0.4 + 整体印象分*0.2】
    switch (category.toString()) {
      case "read_sentence": // 句子
        {
          const {
            accuracy_score,
            emotion_score,
            fluency_score,
            integrity_score,
            phone_score,
            tone_score,
            total_score,
          } = result.read_sentence.rec_paper.read_sentence;
          grade.value = `准确度: ${accuracy_score}\n整体印象分: ${emotion_score}\n流畅度分: ${fluency_score}\n完整度分: ${integrity_score}\n声韵分: ${phone_score}\n调型分: ${tone_score}\n总分: ${total_score}`;
        }
        break;
      case "read_chapter": // 篇章
        {
          const {
            accuracy_score,
            emotion_score,
            fluency_score,
            integrity_score,
            phone_score,
            tone_score,
            total_score,
          } = result.read_chapter.rec_paper.read_chapter;
          grade.value = `准确度: ${accuracy_score}\n整体印象分: ${emotion_score}\n流畅度分: ${fluency_score}\n完整度分: ${integrity_score}\n声韵分: ${phone_score}\n调型分: ${tone_score}\n总分: ${total_score}`;
        }
        break;
      default:
        grade.value = "暂未处理的类型";
        break;
    }
  },
};
// 前端生成 webSocketUrl
const APP_ID = "";
const API_KEY = "";
const API_SECRET = "";
const iseXfyun = new IseXfyun(chapter, category, callback, APP_ID, API_KEY, API_SECRET);
// 后端生成 webSocketUrl
// class MyIseXfyun extends IseXfyun {
//   constructor(
//     chapter: string,
//     category: string,
//     callback: IseXfyunCallback,
//     appId: string
//   ) {
//     super(chapter, category, callback, appId);
//   }
//   getWebSocketUrl(): Promise<string> {
//     return new Promise((resolve, reject) => {
//       const err = "TODO: 实现从后端获取 WebSocket Url 逻辑~";
//       reject(err);
//     });
//   }
// }
// const iseXfyun = new MyIseXfyun(chapter, category, callback, APP_ID);
iseXfyun.enableLog(); // 开启日志

const onRecordBtnClick = () => {
  if (isRecording.value === true) {
    console.log("invoke stop record");
    stopRecord();
  } else {
    console.log("invoke start record");
    startRecord();
  }
};

const onRecordStart = () => {
  isRecording.value = true;
  // 录音开始，连接ws，录音的同时发送数据评测
  iseXfyun.connect();
};
const onRecordStop = () => {
  isRecording.value = false;
};

/**
 * 开始录音
 */
const startRecord = () => {
  recordManager.onStart(() => {
    console.log("recorder start");
    onRecordStart();
  });
  recordManager.onPause(() => {
    console.log("recorder pause");
  });
  recordManager.onStop((res) => {
    // tempFilePath	String	录音文件的临时路径
    console.log("recorder stop", res);
    onRecordStop();
  });
  recordManager.onError((err) => {
    // errMsg	String	错误信息
    console.log("recorder err", err);
  });
  recordManager.onFrameRecorded((res) => {
    // frameBuffer	ArrayBuffer	录音分片结果数据
    // isLastFrame	Boolean	当前帧是否正常录音结束前的最后一帧
    const { frameBuffer } = res;
    iseXfyun.pushAudioData(frameBuffer); // 将每一帧音频保存起来
  });
  recordManager.start(iseXfyun.getAudioRecordOption(duration));
  console.log("recordManager.start(option)");
};

/**
 * 停止录音
 */
const stopRecord = () => {
  if (isRecording.value === true) {
    recordManager.stop();
  }
};
</script>

<style>
.content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
</style>
