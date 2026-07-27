import MetaCloudChannelAdminService from "../MetaCloudChannelAdminService";

describe("MetaCloudChannelAdminService", () => {
  it("rotates and validates tenant secrets without returning plaintext", async () => {
    const credential = {
      id: "credential_1",
      companyId: 7,
      whatsappId: 42,
      appId: "app_1",
      wabaId: "waba_1",
      phoneNumberId: "phone_1",
      graphVersion: "v23.0",
      update: jest.fn().mockResolvedValue(undefined)
    };
    const service = new MetaCloudChannelAdminService({
      findCredential: jest.fn().mockResolvedValue(credential),
      listCredentials: jest.fn(),
      validateConnection: jest.fn().mockResolvedValue({ displayPhoneNumber: "+5511999999999" }),
      encryptSecret: jest.fn(value => `cipher:${value}`),
      keyring: { activeKeyId: "v2", keys: { v2: "unused" } }
    });

    await expect(service.rotate(7, 42, {
      appSecret: "new-app-secret",
      accessToken: "new-access-token"
    })).resolves.toEqual(expect.objectContaining({
      whatsappId: 42,
      validationStatus: "VALID"
    }));
    expect(credential.update).toHaveBeenCalledWith(expect.objectContaining({
      appSecretCiphertext: "cipher:new-app-secret",
      accessTokenCiphertext: "cipher:new-access-token",
      keyVersion: "v2",
      validationStatus: "VALID"
    }));
  });

  it("revokes only the company-owned channel", async () => {
    const credential = { update: jest.fn().mockResolvedValue(undefined), whatsappId: 42 };
    const service = new MetaCloudChannelAdminService({
      findCredential: jest.fn().mockResolvedValue(credential),
      listCredentials: jest.fn(),
      validateConnection: jest.fn(),
      encryptSecret: jest.fn(),
      keyring: { activeKeyId: "v1", keys: { v1: "unused" } }
    });

    await service.revoke(7, 42);
    expect(credential.update).toHaveBeenCalledWith(expect.objectContaining({
      validationStatus: "REVOKED",
      accessTokenCiphertext: ""
    }));
  });
});
