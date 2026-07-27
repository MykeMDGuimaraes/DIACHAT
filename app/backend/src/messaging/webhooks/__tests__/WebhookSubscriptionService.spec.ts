import { createWebhookSubscription, updateWebhookSubscription } from "../WebhookSubscriptionService";

describe("createWebhookSubscription", () => {
  it("encrypts the one-time signing secret and persists tenant filters", async () => {
    const create = jest.fn().mockResolvedValue({ id: "sub_1" });
    const result = await createWebhookSubscription(
      {
        companyId: 7,
        name: "n8n",
        url: "https://hooks.example.com/diachat",
        events: ["message.received", "message.status.updated"],
        connectionIds: [42],
        messageKinds: ["text"],
        includeApiOrigin: false
      },
      {
        create,
        generateSecret: jest.fn().mockReturnValue("secret-once"),
        encryptSecret: jest.fn().mockReturnValue("ciphertext"),
        keyring: { activeKeyId: "v1", keys: { v1: "unused" } }
      }
    );

    expect(result).toEqual({ id: "sub_1", signingSecret: "secret-once" });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 7,
      url: "https://hooks.example.com/diachat",
      secretCiphertext: "ciphertext",
      keyVersion: "v1",
      connectionIds: [42],
      includeApiOrigin: false
    }));
  });

  it("rotates the signing secret without returning the previous plaintext", async () => {
    const subscription = { update: jest.fn() };
    const result = await updateWebhookSubscription(
      { companyId: 7, id: "sub_1", url: "https://hooks.example.com/new", rotateSecret: true },
      {
        find: jest.fn().mockResolvedValue(subscription),
        generateSecret: jest.fn().mockReturnValue("rotated-once"),
        encryptSecret: jest.fn().mockReturnValue("new-ciphertext"),
        keyring: { activeKeyId: "v2", keys: { v2: "unused" } }
      }
    );

    expect(result).toEqual({ id: "sub_1", signingSecret: "rotated-once" });
    expect(subscription.update).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://hooks.example.com/new",
      secretCiphertext: "new-ciphertext",
      keyVersion: "v2"
    }));
  });
});
