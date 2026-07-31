import { createMessageMediaHandler } from "../MessageMediaController";

const media = {
  messageId: "message-1",
  absolutePath: "C:\\safe\\file.jpg",
  fileName: "file.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 3
};

const response = () => ({
  set: jest.fn().mockReturnThis(),
  type: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
  download: jest.fn().mockReturnThis()
}) as any;

describe("MessageMediaController", () => {
  const service = {
    resolve: jest.fn().mockResolvedValue(media),
    json: jest.fn().mockResolvedValue({ messageId: "message-1" })
  };

  beforeEach(() => jest.clearAllMocks());

  it("returns URL metadata by default and can include Base64", async () => {
    const req = {
      apiCredential: { companyId: 2, connectionIds: [7] },
      params: { messageId: "message-1" },
      query: { includeBase64: "true" }
    } as any;
    const res = response();

    await createMessageMediaHandler(service)(req, res);

    expect(service.resolve).toHaveBeenCalledWith({ companyId: 2, allowedConnectionIds: [7], messageId: "message-1" });
    expect(service.json).toHaveBeenCalledWith(media, { companyId: 2, includeUrl: true, includeBase64: true });
    expect(res.json).toHaveBeenCalledWith({ messageId: "message-1" });
  });

  it("streams an authenticated attachment when format=download", async () => {
    const req = {
      apiCredential: { companyId: 2, connectionIds: [7] },
      params: { messageId: "message-1" },
      query: { format: "download" }
    } as any;
    const res = response();

    await createMessageMediaHandler(service)(req, res);

    expect(res.type).toHaveBeenCalledWith("image/jpeg");
    expect(res.download).toHaveBeenCalledWith(media.absolutePath, media.fileName);
    expect(service.json).not.toHaveBeenCalled();
  });

  it("returns Base64 without a URL when format=base64", async () => {
    const req = {
      apiCredential: { companyId: 2, connectionIds: [7] },
      params: { messageId: "message-1" },
      query: { format: "base64" }
    } as any;
    const res = response();

    await createMessageMediaHandler(service)(req, res);

    expect(service.json).toHaveBeenCalledWith(media, { companyId: 2, includeUrl: false, includeBase64: true });
  });

  it("rejects invalid or incompatible query combinations", async () => {
    const handler = createMessageMediaHandler(service);
    const res = response();
    const base = { apiCredential: { companyId: 2, connectionIds: [7] }, params: { messageId: "message-1" } };

    await expect(handler({ ...base, query: { format: "raw" } } as any, res)).rejects.toMatchObject({ statusCode: 400 });
    await expect(handler({ ...base, query: { format: "download", includeBase64: "true" } } as any, res)).rejects.toMatchObject({ statusCode: 400 });
  });
});
