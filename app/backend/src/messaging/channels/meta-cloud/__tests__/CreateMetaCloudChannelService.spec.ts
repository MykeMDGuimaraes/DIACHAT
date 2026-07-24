import {
  CreateMetaCloudChannelDependencies,
  createMetaCloudChannel
} from "../CreateMetaCloudChannelService";

describe("createMetaCloudChannel", () => {
  const input = {
    companyId: 7,
    name: "Suporte oficial",
    appId: "app_1",
    appSecret: "app-secret",
    accessToken: "access-token",
    wabaId: "waba_1",
    phoneNumberId: "phone_1"
  };

  it("validates the submitted credentials and persists only encrypted secrets", async () => {
    const dependencies: CreateMetaCloudChannelDependencies = {
      validateConnection: jest.fn().mockResolvedValue({ displayPhoneNumber: "+55 11 99999-9999" }),
      createWhatsapp: jest.fn().mockResolvedValue({ whatsapp: { id: 42 } }),
      createCredential: jest.fn().mockResolvedValue({ publicId: "credential_1" }),
      encryptSecret: jest.fn(secret => `cipher:${secret}`),
      keyring: { activeKeyId: "v1", keys: { v1: "unused" } },
      generateVerifyToken: jest.fn().mockReturnValue("verify-once"),
      hashVerifyToken: jest.fn().mockReturnValue("verify-hash")
    };

    await expect(createMetaCloudChannel(input, dependencies)).resolves.toEqual({
      whatsappId: 42,
      credentialPublicId: "credential_1",
      verifyToken: "verify-once",
      displayPhoneNumber: "+55 11 99999-9999"
    });

    expect(dependencies.createWhatsapp).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 7,
        name: "Suporte oficial",
        channelType: "meta_cloud",
        status: "OPEN"
      })
    );
    expect(dependencies.createCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 7,
        whatsappId: 42,
        appId: "app_1",
        wabaId: "waba_1",
        phoneNumberId: "phone_1",
        accessTokenCiphertext: "cipher:access-token",
        appSecretCiphertext: "cipher:app-secret",
        verifyTokenHash: "verify-hash",
        keyVersion: "v1"
      })
    );
    expect(dependencies.createWhatsapp).not.toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: expect.anything(), appSecret: expect.anything() })
    );
  });
});
