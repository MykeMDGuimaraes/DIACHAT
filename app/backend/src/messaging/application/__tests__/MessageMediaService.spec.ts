import AppError from "../../../errors/AppError";
import MessageMediaService from "../MessageMediaService";

const record = (values: Record<string, unknown>) => ({
  ...values,
  getDataValue: (field: string) => values[field]
});

const dependencies = (overrides: Record<string, unknown> = {}) => ({
  findMessage: jest.fn().mockResolvedValue(record({
    id: "message-1",
    mediaUrl: "messaging/file.jpg",
    mediaType: "image",
    ticketId: 12
  })),
  findTicket: jest.fn().mockResolvedValue(record({ id: 12, whatsappId: 7 })),
  realpath: jest.fn(async (value: string) => value),
  stat: jest.fn().mockResolvedValue({ isFile: () => true, size: 3 }),
  readFile: jest.fn().mockResolvedValue(Buffer.from("abc")),
  hashFile: jest.fn().mockResolvedValue("sha256-value"),
  ...overrides
});

describe("MessageMediaService", () => {
  const previousSecret = process.env.SESSION_SECRET;
  const previousLimit = process.env.MESSAGING_MEDIA_BASE64_MAX_BYTES;

  beforeEach(() => {
    process.env.SESSION_SECRET = "test-session-secret";
    delete process.env.MESSAGING_MEDIA_BASE64_MAX_BYTES;
  });

  afterAll(() => {
    process.env.SESSION_SECRET = previousSecret;
    process.env.MESSAGING_MEDIA_BASE64_MAX_BYTES = previousLimit;
  });

  it("returns safe metadata and a signed URL for an allowed connection", async () => {
    const service = new MessageMediaService(dependencies());
    const media = await service.resolve({ companyId: 2, allowedConnectionIds: [7], messageId: "message-1" });
    const body = await service.json(media, { companyId: 2, includeUrl: true, includeBase64: false });

    expect(body).toMatchObject({
      messageId: "message-1",
      mediaType: "image",
      mimeType: "image/jpeg",
      sizeBytes: 3,
      sha256: "sha256-value",
      available: true
    });
    expect(body).not.toHaveProperty("base64");
    expect(body.downloadUrl).toContain("/api/v1/transcript/media/message-1");
    expect(body.url).toBe(body.downloadUrl);
    expect(body.expiresAt).toEqual(expect.any(String));
  });

  it("can include the Base64 representation without returning a signed URL", async () => {
    const service = new MessageMediaService(dependencies());
    const media = await service.resolve({ companyId: 2, allowedConnectionIds: [7], messageId: "message-1" });
    const body = await service.json(media, { companyId: 2, includeUrl: false, includeBase64: true });

    expect(body).toMatchObject({ encoding: "base64", base64: "YWJj", url: null, downloadUrl: null, expiresAt: null });
  });

  it("does not expose media from another connection allowed to the same company", async () => {
    const deps = dependencies();
    const service = new MessageMediaService(deps);

    await expect(service.resolve({ companyId: 2, allowedConnectionIds: [8], messageId: "message-1" }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(deps.realpath).not.toHaveBeenCalled();
  });

  it("rejects path traversal and oversized Base64 responses", async () => {
    const traversal = new MessageMediaService(dependencies({
      findMessage: jest.fn().mockResolvedValue(record({ id: "message-1", mediaUrl: "../secret", mediaType: "document", ticketId: 12 }))
    }));
    await expect(traversal.resolve({ companyId: 2, allowedConnectionIds: [7], messageId: "message-1" }))
      .rejects.toBeInstanceOf(AppError);

    process.env.MESSAGING_MEDIA_BASE64_MAX_BYTES = "2";
    const service = new MessageMediaService(dependencies());
    const media = await service.resolve({ companyId: 2, allowedConnectionIds: [7], messageId: "message-1" });
    await expect(service.json(media, { companyId: 2, includeUrl: false, includeBase64: true }))
      .rejects.toMatchObject({ statusCode: 413, message: "MEDIA_BASE64_TOO_LARGE" });
  });
});
