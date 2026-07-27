import MetaCloudMessageCommandProvider from "../MetaCloudMessageCommandProvider";

const textCommand = {
  id: "command_1",
  companyId: 7,
  whatsappId: 42,
  provider: "meta_cloud",
  messageKind: "text",
  recipient: "5511999999999",
  requestPayload: { text: "Oi" }
} as const;

describe("MetaCloudMessageCommandProvider", () => {
  it("classifies a credential-store failure before transmission as retryable", async () => {
    const provider = new MetaCloudMessageCommandProvider({
      findCredential: jest.fn().mockRejectedValue(new Error("db offline")),
      decryptSecret: jest.fn(),
      getKeyring: jest.fn(),
      sendText: jest.fn()
    } as any);

    await expect(provider.send(textCommand)).rejects.toMatchObject({
      classification: "retryable",
      code: "META_CREDENTIAL_STORE_UNAVAILABLE"
    });
  });

  it.each([
    {
      name: "keyring loading",
      getKeyring: jest.fn(() => {
        throw new Error("missing platform key");
      }),
      decryptSecret: jest.fn()
    },
    {
      name: "tenant-token decryption",
      getKeyring: jest
        .fn()
        .mockReturnValue({ activeKeyId: "v1", keys: { v1: "unused" } }),
      decryptSecret: jest.fn(() => {
        throw new Error("invalid authentication tag");
      })
    }
  ])(
    "classifies $name failure as permanent operational, never unknown",
    async ({ getKeyring, decryptSecret }) => {
      const provider = new MetaCloudMessageCommandProvider({
        findCredential: jest.fn().mockResolvedValue({
          phoneNumberId: "phone_1",
          accessTokenCiphertext: "ciphertext"
        }),
        decryptSecret,
        getKeyring,
        sendText: jest.fn()
      } as any);

      await expect(provider.send(textCommand)).rejects.toMatchObject({
        classification: "permanent",
        code: "META_CREDENTIAL_DECRYPTION_FAILED"
      });
    }
  );

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

    await expect(
      provider.send({
        companyId: 1,
        whatsappId: 2,
        provider: "meta_cloud",
        messageKind: "text",
        recipient: "5511999999999",
        requestPayload: { text: "oi" }
      } as any)
    ).rejects.toMatchObject({
      classification: "permanent",
      code: "META_VALIDATION_FAILED",
      providerStatus: 409
    });
    expect(decryptSecret).not.toHaveBeenCalled();
  });

  it("decrypts the tenant token only at dispatch time and sends through the Graph API", async () => {
    const sendText = jest
      .fn()
      .mockResolvedValue({ providerMessageId: "wamid.1" });
    const provider = new MetaCloudMessageCommandProvider({
      findCredential: jest.fn().mockResolvedValue({
        phoneNumberId: "phone_1",
        accessTokenCiphertext: "ciphertext"
      }),
      decryptSecret: jest.fn().mockReturnValue("access-token"),
      getKeyring: jest
        .fn()
        .mockReturnValue({ activeKeyId: "v1", keys: { v1: "unused" } }),
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
        requestPayload: { text: "Olá" }
      })
    ).resolves.toEqual({ providerMessageId: "wamid.1" });

    expect(sendText).toHaveBeenCalledWith({
      phoneNumberId: "phone_1",
      accessToken: "access-token",
      recipient: "5511999999999",
      text: "Olá"
    });
  });

  it("routes supported media through the same tenant-scoped provider", async () => {
    const sendMessage = jest
      .fn()
      .mockResolvedValue({ providerMessageId: "wamid.media" });
    const provider = new MetaCloudMessageCommandProvider({
      findCredential: jest.fn().mockResolvedValue({
        phoneNumberId: "phone_1",
        accessTokenCiphertext: "ciphertext"
      }),
      decryptSecret: jest.fn().mockReturnValue("access-token"),
      getKeyring: jest
        .fn()
        .mockReturnValue({ activeKeyId: "v1", keys: { v1: "unused" } }),
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
      requestPayload: {
        link: "https://cdn.example.com/photo.jpg",
        caption: "Foto"
      }
    });

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "image",
        payload: { link: "https://cdn.example.com/photo.jpg", caption: "Foto" }
      })
    );
  });
});
