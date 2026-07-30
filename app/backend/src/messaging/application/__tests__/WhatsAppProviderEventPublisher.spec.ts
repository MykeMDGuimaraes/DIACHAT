import { createProviderEvent } from "../../domain/WhatsAppProviderEvent";
import WhatsAppProviderEventPublisher, {
  buildWhatsAppChatStatePatch,
  shouldApplyChatStateRevision
} from "../WhatsAppProviderEventPublisher";
import { decryptWebhookBody } from "../../webhooks/WebhookBodyCipher";
import { whatsAppOutboxBodyBinding } from "../../webhooks/WhatsAppOutboxBodyCipher";

const chatEvent = () => ({
  ...createProviderEvent({
    context: {
      companyId: 7,
      whatsappId: 42,
      conversationId: "conversation-1",
      contactId: "3"
    },
    eventType: "chat.updated",
    providerName: "baileys",
    providerEventId: "chat-5511999999999-1722000000",
    occurredAt: new Date("2024-07-26T13:20:00.000Z"),
    revision: "1722000000000",
    jid: "5511999999999@s.whatsapp.net"
  }),
  chatState: {
    companyId: 7,
    whatsappId: 42,
    jid: "5511999999999@s.whatsapp.net",
    lid: null,
    isGroup: false,
    archived: true,
    pinned: false,
    mutedUntil: null,
    unreadCount: 2,
    lastMessageId: "message-1",
    lastMessageAt: new Date("2024-07-26T13:19:59.000Z"),
    lastMessagePreview: "olá",
    revision: "1722000000000"
  }
});

describe("WhatsAppProviderEventPublisher", () => {
  it("applies a later observed equal revision but rejects a truly older timestamp", () => {
    expect(shouldApplyChatStateRevision("1722000000000", "1722000000000")).toBe(
      true
    );
    expect(shouldApplyChatStateRevision("1722000000000", "1721999999999")).toBe(
      false
    );
  });
  it("stores rich provider data only in the authenticated encrypted outbox body", async () => {
    const persisted: any[] = [];
    const keyring = {
      activeKeyId: "body-v2",
      keys: {
        "body-v2": Buffer.alloc(32, 7).toString("base64")
      }
    };
    const event = {
      ...chatEvent(),
      payload: {
        ...chatEvent().payload,
        text: "segredo do motorista",
        jid: "5511999999999@s.whatsapp.net",
        phone: "+55 11 99999-9999",
        vcard: "BEGIN:VCARD\nFN:Motorista Particular\nEND:VCARD"
      }
    };
    const publisher = new WhatsAppProviderEventPublisher({
      mirrorEnabled: () => true,
      transaction: callback => callback("tx"),
      newId: () => "outbox-event-1",
      getKeyring: () => keyring,
      findOrCreateEvent: async item => {
        persisted.push(item);
        return [{}, true];
      },
      upsertChatState: jest.fn()
    });

    await publisher.publish([event]);

    const stored = persisted[0];
    const searchable = JSON.stringify({
      payload: stored.payload,
      bodyCiphertext: undefined
    });
    expect(searchable).not.toContain("segredo do motorista");
    expect(searchable).not.toContain("5511999999999");
    expect(searchable).not.toContain("+55 11");
    expect(searchable).not.toContain("Motorista Particular");
    expect(stored.payload).toEqual(
      expect.objectContaining({
        whatsappId: 42,
        conversationId: "conversation-1",
        contactId: "3"
      })
    );
    const decrypted = decryptWebhookBody(
      {
        bodyCiphertext: stored.bodyCiphertext,
        bodyKeyVersion: stored.bodyKeyVersion,
        bodySha256: stored.bodySha256
      },
      whatsAppOutboxBodyBinding(7, "outbox-event-1"),
      keyring
    );
    expect(JSON.parse(decrypted.toString("utf8"))).toEqual(event.payload);
  });

  it("patches only chat fields supplied by a partial provider update", () => {
    const patch = buildWhatsAppChatStatePatch({
      companyId: 7,
      whatsappId: 42,
      jid: "5511999999999@s.whatsapp.net",
      archived: true,
      revision: "1722000000000"
    });

    expect(patch).toEqual({
      archived: true,
      revision: "1722000000000"
    });
    expect(patch).not.toHaveProperty("pinned");
    expect(patch).not.toHaveProperty("mutedUntil");
    expect(patch).not.toHaveProperty("unreadCount");
    expect(patch).not.toHaveProperty("lastMessageId");
  });

  it("persists a chat event and state atomically only once for duplicate aggregate identities", async () => {
    const operations: string[] = [];
    const findOrCreateEvent = jest
      .fn()
      .mockResolvedValueOnce([{}, true])
      .mockResolvedValueOnce([{}, false]);
    const upsertChatState = jest.fn().mockImplementation(async (_state, tx) => {
      operations.push(`state:${tx}`);
    });
    const publisher = new WhatsAppProviderEventPublisher({
      mirrorEnabled: () => true,
      newId: () => "event-id",
      getKeyring: () => ({
        activeKeyId: "body-v1",
        keys: { "body-v1": Buffer.alloc(32, 3).toString("base64") }
      }),
      transaction: async callback => {
        operations.push("begin");
        const result = await callback("tx");
        operations.push("commit");
        return result;
      },
      findOrCreateEvent: async (event, tx) => {
        operations.push(`event:${tx}`);
        return findOrCreateEvent(event, tx);
      },
      upsertChatState
    });
    const event = chatEvent();

    await publisher.publish([event, event]);

    expect(event.aggregateId).toMatch(/^[a-f0-9]{64}$/);
    expect(findOrCreateEvent).toHaveBeenCalledTimes(2);
    expect(upsertChatState).toHaveBeenCalledTimes(1);
    expect(upsertChatState).toHaveBeenCalledWith(event.chatState, "tx");
    expect(operations).toEqual([
      "begin",
      "event:tx",
      "state:tx",
      "event:tx",
      "commit"
    ]);
  });
});
