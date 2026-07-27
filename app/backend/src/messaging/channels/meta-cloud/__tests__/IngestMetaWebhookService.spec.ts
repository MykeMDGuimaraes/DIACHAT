import { createHmac } from "crypto";
import { ingestMetaWebhook } from "../IngestMetaWebhookService";

describe("ingestMetaWebhook", () => {
  it("stores a signed provider callback and an outbox event in the same transaction", async () => {
    const rawBody = '{"entry":[{"id":"waba_1"}]}' ;
    const signature = `sha256=${createHmac("sha256", "app-secret")
      .update(rawBody)
      .digest("hex")}`;
    const transaction = { id: "tx_1" };
    const createInbox = jest.fn().mockResolvedValue({ id: "inbox_1" });
    const createOutbox = jest.fn();

    await expect(
      ingestMetaWebhook(
        {
          credentialPublicId: "credential_1",
          rawBody,
          signature,
          payload: { entry: [{ id: "waba_1" }] }
        },
        {
          transaction: async callback => callback(transaction),
          findCredential: jest.fn().mockResolvedValue({
            companyId: 7,
            whatsappId: 42,
            appSecretCiphertext: "ciphertext"
          }),
          decryptSecret: jest.fn().mockReturnValue("app-secret"),
          getKeyring: jest.fn().mockReturnValue({ activeKeyId: "v1", keys: { v1: "unused" } }),
          findInbox: jest.fn().mockResolvedValue(null),
          createInbox,
          createOutbox
        }
      )
    ).resolves.toEqual({ accepted: true, duplicate: false });

    expect(createInbox).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 7,
        whatsappId: 42,
        provider: "meta_cloud",
        payload: { entry: [{ id: "waba_1" }] }
      }),
      transaction
    );
    expect(createOutbox).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "meta.callback.received", aggregateId: "inbox_1" }),
      transaction
    );
  });
});
