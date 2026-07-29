export class WhatsAppMirrorUnsafePayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsAppMirrorUnsafePayloadError";
  }
}
