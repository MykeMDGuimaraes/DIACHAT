import MetaMediaService from "../MetaMediaService";

describe("MetaMediaService", () => {
  it("downloads tenant media with the decrypted token and persists a deterministic file", async () => {
    const writeFile = jest.fn().mockResolvedValue(undefined);
    const service = new MetaMediaService({
      findCredential: jest.fn().mockResolvedValue({
        accessTokenCiphertext: "cipher",
        graphVersion: "v23.0"
      }),
      decryptToken: jest.fn().mockReturnValue("access-token"),
      getMetadata: jest.fn().mockResolvedValue({
        url: "https://lookaside.fbsbx.com/media/1",
        mimeType: "image/jpeg"
      }),
      download: jest.fn().mockResolvedValue(Buffer.from("image")),
      writeFile,
      publicDirectory: "C:\\public"
    });

    await expect(service.download(7, 42, {
      providerMessageId: "wamid.1",
      mediaId: "media_1",
      mimeType: "image/jpeg"
    } as any)).resolves.toEqual({
      fileName: "meta-7-wamid.1.jpg",
      mimeType: "image/jpeg"
    });
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining("meta-7-wamid.1.jpg"),
      Buffer.from("image")
    );
  });
});
