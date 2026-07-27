import { verifyMetaWebhookChallenge } from "../MetaWebhookVerificationService";

describe("verifyMetaWebhookChallenge", () => {
  it("accepts the Meta challenge only when the submitted token matches the stored HMAC", async () => {
    const credential = { verifyTokenHash: "stored-hash", update: jest.fn() };
    const dependencies = {
      findCredential: jest.fn().mockResolvedValue(credential),
      hashVerifyToken: jest.fn().mockReturnValue("stored-hash")
    };

    await expect(
      verifyMetaWebhookChallenge(
        {
          credentialPublicId: "credential_1",
          mode: "subscribe",
          verifyToken: "verify-once",
          challenge: "challenge-value"
        },
        dependencies
      )
    ).resolves.toEqual("challenge-value");

    expect(credential.update).toHaveBeenCalledWith(
      expect.objectContaining({ validationStatus: "WEBHOOK_VERIFIED" })
    );
  });

  it("rejects a token with a different HMAC", async () => {
    await expect(
      verifyMetaWebhookChallenge(
        {
          credentialPublicId: "credential_1",
          mode: "subscribe",
          verifyToken: "wrong-token",
          challenge: "challenge-value"
        },
        {
          findCredential: jest.fn().mockResolvedValue({ verifyTokenHash: "stored-hash" }),
          hashVerifyToken: jest.fn().mockReturnValue("other-hash")
        }
      )
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
