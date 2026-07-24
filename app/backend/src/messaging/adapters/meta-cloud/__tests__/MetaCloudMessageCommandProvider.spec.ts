import MetaCloudMessageCommandProvider from "../MetaCloudMessageCommandProvider";

describe("MetaCloudMessageCommandProvider", () => {
  it("rejects a revoked credential before decrypting it", async () => {
    const decryptSecret = jest.fn();
    const provider = new MetaCloudMessageCommandProvider({
      findCredential: jest.fn().mockResolvedValue({
        validationStatus: "REVOKED",
        revokedAt: new Date()
      }),
      decryptSecret,
      getKeyring: jest.fn(),
      sendText: jest.fn()
    } as any);

    await expect(provider.send({
      companyId: 1,
      whatsappId: 2,
      provider: "meta_cloud",
      messageKind: "text",
      recipient: "5511999999999",
      requestPayload: { text: "oi" }
    } as any)).rejects.toMatchObject({ statusCode: 409 });
    expect(decryptSecret).not.toHaveBeenCalled();
  });

  it("decrypts the tenant token only at dispatch time and sends through the Graph API", async () => {
    const sendText = jest.fn().mockResolvedValue({ providerMessageId: "wamid.1" });
    const provider = new MetaCloudMessageCommandProvider({
      findCredential: jest.fn().mockResolvedValue({
        phoneNumberId: "phone_1",
        accessTokenCiphertext: "ciphertext"
      }),
      decryptSecret: jest.fn().mockReturnValue("access-token"),
      getKeyring: jest.fn().mockReturnValue({ activeKeyId: "v1", keys: { v1: "unused" } }),
      sendText
    });

    await expect(
      provider.send({
        id: "command_1",
        companyId: 7,
        whatsappId: 42,
        provider: "meta_cloud",
        messageKind: "text",
        recipient: "5511999999999",
        requestPayload: { text: "OlÃ¡" }
      })
    ).resolves.toEqual({ providerMessageId: "wamid.1" });

    expect(sendText).toHaveBeenCalledWith({
      phoneNumberId: "phone_1",
      accessToken: "access-token",
      recipient: "5511999999999",
      text: "OlÃ¡"
    });
  });

  it("routes supported media through the same tenant-scoped provider", async () => {
    const sendMessage = jest.fn().mockResolvedValue({ providerMessageId: "wamid.media" });
    const provider = new MetaCloudMessageCommandProvider({
      findCredential: jest.fn().mockResolvedValue({
        phoneNumberId: "phone_1",
        accessTokenCiphertext: "ciphertext"
      }),
      decryptSecret: jest.fn().mockReturnValue("access-token"),
      getKeyring: jest.fn().mockReturnValue({ activeKeyId: "v1", keys: { v1: "unused" } }),
      sendText: jest.fn(),
      sendMessage
    });

    await provider.send({
      id: "command_2",
      companyId: 7,
      whatsappId: 42,
      provider: "meta_cloud",
      messageKind: "image",
      recipient: "5511999999999",
      requestPayload: { link: "https://cdn.example.com/photo.jpg", caption: "Foto" }
    });

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      kind: "image",
      payload: { link: "https://cdn.example.com/photo.jpg", caption: "Foto" }
    }));
  });
});
