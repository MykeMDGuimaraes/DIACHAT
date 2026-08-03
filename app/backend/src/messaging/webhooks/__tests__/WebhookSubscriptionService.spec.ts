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
        includeApiOrigin: false,
        excludeFilters: ["fromMe", "group", "fromMe"]
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
      includeApiOrigin: false,
      excludeFilters: ["fromMe", "group"]
    }));
  });

  it("rejects unknown exclusion filters", async () => {
    await expect(
      createWebhookSubscription(
        {
          companyId: 7,
          name: "invalid",
          url: "https://hooks.example.com/diachat",
          events: ["message.received"],
          excludeFilters: ["phoneNumber" as any]
        },
        {
          create: jest.fn(),
          generateSecret: jest.fn(),
          encryptSecret: jest.fn(),
          keyring: { activeKeyId: "v1", keys: { v1: "unused" } }
        }
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("allows clearing exclusion filters on update", async () => {
    const subscription = { update: jest.fn() };
    await updateWebhookSubscription(
      { companyId: 7, id: "sub_1", excludeFilters: [] },
      {
        find: jest.fn().mockResolvedValue(subscription),
        generateSecret: jest.fn(),
        encryptSecret: jest.fn(),
        keyring: { activeKeyId: "v1", keys: { v1: "unused" } }
      }
    );
    expect(subscription.update).toHaveBeenCalledWith({ excludeFilters: [] });
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

  it("accepts every event required by the Router contract", async () => {
    const create = jest.fn().mockResolvedValue({ id: "router-sub" });

    await expect(
      createWebhookSubscription(
        {
          companyId: 7,
          name: "Roteador",
          url: "https://router.example.com/api/v1/webhooks/dia-chat",
          events: [
            "button.clicked",
            "message.received",
            "message.sent",
            "message.failed",
            "message.status.updated",
            "handoff.paused",
            "handoff.released",
            "conversation.created",
            "conversation.updated"
          ],
          includeApiOrigin: true
        },
        {
          create,
          generateSecret: jest.fn().mockReturnValue("secret-once"),
          encryptSecret: jest.fn().mockReturnValue("ciphertext"),
          keyring: { activeKeyId: "v1", keys: { v1: "unused" } }
        }
      )
    ).resolves.toMatchObject({ id: "router-sub" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ includeApiOrigin: true })
    );
  });

  it("expands message.received subscriptions to every WhatsApp mirror event", async () => {
    const create = jest.fn().mockResolvedValue({ id: "mirror-sub" });
    await createWebhookSubscription(
      {
        companyId: 7,
        name: "Mirror",
        url: "https://hooks.example.com/mirror",
        events: ["message.received"]
      },
      {
        create,
        generateSecret: jest.fn().mockReturnValue("secret-once"),
        encryptSecret: jest.fn().mockReturnValue("ciphertext"),
        keyring: { activeKeyId: "v1", keys: { v1: "unused" } }
      }
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        events: [
          "message.received",
          "message.reaction",
          "message.edited",
          "message.deleted",
          "chat.updated",
          "connection.updated"
        ]
      })
    );

    const subscription = { update: jest.fn() };
    await updateWebhookSubscription(
      {
        companyId: 7,
        id: "mirror-sub",
        events: ["message.received"]
      },
      {
        find: jest.fn().mockResolvedValue(subscription),
        generateSecret: jest.fn(),
        encryptSecret: jest.fn(),
        keyring: { activeKeyId: "v1", keys: { v1: "unused" } }
      }
    );
    expect(subscription.update).toHaveBeenCalledWith({
      events: [
        "message.received",
        "message.reaction",
        "message.edited",
        "message.deleted",
        "chat.updated",
        "connection.updated"
      ]
    });
  });
});
