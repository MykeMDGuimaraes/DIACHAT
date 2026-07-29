import { createProviderEvent } from "../../domain/WhatsAppProviderEvent";
import WhatsAppProviderEventPublisher, {
  buildWhatsAppChatStatePatch
} from "../WhatsAppProviderEventPublisher";

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
