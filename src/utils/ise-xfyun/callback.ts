interface IseXfyunCallback {
  onOpen(): void;
  onClose(): void;
  onError(error: UniApp.GeneralCallbackResult): void;
  onResult(result: any): void;
}
