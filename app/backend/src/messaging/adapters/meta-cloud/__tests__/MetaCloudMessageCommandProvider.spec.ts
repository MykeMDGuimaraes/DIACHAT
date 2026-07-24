import MetaCloudMessageCommandProvider from "../MetaCloudMessageCommandProvider";

describe("MetaCloudMessageCommandProvider", () => {
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
});
