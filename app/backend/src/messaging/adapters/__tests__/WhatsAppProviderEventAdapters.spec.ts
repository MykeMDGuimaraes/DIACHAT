import {
  adaptBaileysChatUpdate,
  adaptBaileysConnectionUpdate,
  adaptBaileysMessageEvents,
  registerBaileysMirrorLifecycleListeners
} from "../baileys/BaileysProviderEventAdapter";
import {
  adaptMetaChatUpdate,
  adaptMetaConnectionUpdate,
  adaptMetaLifecycleEvents,
  adaptMetaMessageEvents
} from "../meta-cloud/MetaProviderEventAdapter";
import { registerBaileysMirrorLifecycleListeners as publicLifecycleRegister } from "../../public/baileys";

jest.mock("../baileys/BaileysExports", () => ({
  __esModule: true,
  default: {}
}));
jest.mock("../baileys/BaileysSocketPort", () => ({
  sendBaileysSocketMessage: jest.fn()
}));
jest.mock("../baileys/BaileysLogger", () => ({
  __esModule: true,
  default: {}
}));

const context = {
  companyId: 7,
  whatsappId: 42,
  conversationId: "conversation-1",
  contactId: "3",
  externalTicketId: "ticket-9",
  automationEpoch: 5
};

describe("WhatsApp provider event adapters", () => {
  it("exposes lifecycle listener registration only through the Baileys public facade", () => {
    expect(publicLifecycleRegister).toBe(
      registerBaileysMirrorLifecycleListeners
    );
  });

  it("maps provider buttons to the same null-complete DTO shape and keeps message.received plus button.clicked", () => {
    const baileys = adaptBaileysMessageEvents({
      ...context,
      raw: {
        key: {
          id: "provider-message-1",
          remoteJid: "5511999999999@s.whatsapp.net",
          fromMe: false
        },
        messageTimestamp: 1_722_000_000,
        message: {
          buttonsResponseMessage: {
            selectedButtonId: "accept:ticket-9",
            selectedDisplayText: "Aceitar"
          }
        }
      }
    });
    const meta = adaptMetaMessageEvents({
      ...context,
      raw: {
        id: "provider-message-1",
        from: "5511999999999",
        timestamp: "1722000000",
        type: "interactive",
        interactive: {
          type: "button_reply",
          button_reply: {
            id: "accept:ticket-9",
            title: "Aceitar"
          }
        }
      }
    });

    expect(baileys.map(event => event.eventType)).toEqual([
      "message.received",
      "button.clicked"
    ]);
    expect(meta.map(event => event.eventType)).toEqual([
      "message.received",
      "button.clicked"
    ]);

    for (const events of [baileys, meta]) {
      expect(Object.keys(events[0].payload).sort()).toEqual(
        Object.keys(events[1].payload).sort()
      );
      expect(events[0].payload.connection).toEqual({
        id: 42,
        publicId: null,
        state: null,
        phoneNumber: null
      });
      expect(events[0].payload.message.quoted).toBeNull();
      expect(events[0].payload.message.media).toBeNull();
      expect(events[0].payload.message.location).toBeNull();
      expect(events[0].payload.message.contacts).toBeNull();
      expect(events[0].payload.message.poll).toBeNull();
      expect(events[0].payload.message.edit).toBeNull();
      expect(events[0].payload.message.delete).toBeNull();
      expect(events[1].payload.message.interactive).toEqual({
        type: "button",
        id: "accept:ticket-9",
        title: "Aceitar",
        description: null
      });
    }
  });

  it.each([
    {
      eventType: "message.reaction",
      baileysRaw: {
        key: {
          id: "reaction-1",
          remoteJid: "5511999999999@s.whatsapp.net",
          fromMe: false
        },
        messageTimestamp: 1_722_000_001,
        message: {
          reactionMessage: {
            key: { id: "target-message-1" },
            text: "👍"
          }
        }
      },
      metaRaw: {
        id: "reaction-1",
        from: "5511999999999",
        timestamp: "1722000001",
        type: "reaction",
        reaction: { message_id: "target-message-1", emoji: "👍" }
      },
      block: "reaction",
      expected: {
        emoji: "👍",
        targetMessageId: "target-message-1",
        removed: false
      }
    },
    {
      eventType: "message.edited",
      baileysRaw: {
        key: {
          id: "edit-1",
          remoteJid: "5511999999999@s.whatsapp.net",
          fromMe: false
        },
        messageTimestamp: 1_722_000_002,
        message: {
          editedMessage: {
            message: {
              protocolMessage: {
                key: { id: "target-message-1" },
                editedMessage: { conversation: "texto corrigido" }
              }
            }
          }
        }
      },
      metaRaw: {
        id: "edit-1",
        from: "5511999999999",
        timestamp: "1722000002",
        type: "edited",
        edit: {
          message_id: "target-message-1",
          text: "texto corrigido"
        }
      },
      block: "edit",
      expected: {
        targetMessageId: "target-message-1",
        text: "texto corrigido",
        editedAt: "2024-07-26T13:20:02.000Z"
      }
    },
    {
      eventType: "message.deleted",
      baileysRaw: {
        key: {
          id: "delete-1",
          remoteJid: "5511999999999@s.whatsapp.net",
          fromMe: false
        },
        messageTimestamp: 1_722_000_003,
        message: {
          protocolMessage: {
            key: { id: "target-message-1" },
            type: 0
          }
        }
      },
      metaRaw: {
        id: "delete-1",
        from: "5511999999999",
        timestamp: "1722000003",
        type: "deleted",
        delete: { message_id: "target-message-1", for_everyone: true }
      },
      block: "delete",
      expected: {
        targetMessageId: "target-message-1",
        deletedAt: "2024-07-26T13:20:03.000Z",
        forEveryone: true
      }
    }
  ])(
    "emits only $eventType for the corresponding provider update",
    ({ eventType, baileysRaw, metaRaw, block, expected }) => {
      const baileys = adaptBaileysMessageEvents({
        ...context,
        raw: baileysRaw
      });
      const meta = adaptMetaMessageEvents({ ...context, raw: metaRaw });

      expect(baileys).toHaveLength(1);
      expect(meta).toHaveLength(1);
      expect(baileys[0].eventType).toBe(eventType);
      expect(meta[0].eventType).toBe(eventType);
      expect((baileys[0].payload.message as any)[block]).toEqual(expected);
      expect((meta[0].payload.message as any)[block]).toEqual(expected);
    }
  );

  it("maps chat and connection updates to provider-neutral deterministic identities", () => {
    const observedAt = new Date("2024-07-26T13:20:04.000Z");
    const baileysChatInput = {
      ...context,
      observedAt,
      raw: {
        id: "5511999999999@s.whatsapp.net",
        conversationTimestamp: 1_722_000_004,
        archived: true,
        pin: 0,
        muteEndTime: null,
        unreadCount: 4,
        lastMessageRecvTimestamp: 1_722_000_003,
        messages: [{ key: { id: "message-4" }, message: { conversation: "oi" } }]
      }
    };
    const baileysChat = adaptBaileysChatUpdate(baileysChatInput);
    const metaChat = adaptMetaChatUpdate({
      ...context,
      observedAt,
      raw: {
        jid: "5511999999999@s.whatsapp.net",
        timestamp: "1722000004",
        archived: true,
        pinned: false,
        muted_until: null,
        unread_count: 4,
        last_message_id: "message-4",
        last_message_at: "1722000003",
        last_message_preview: "oi"
      }
    });
    const baileysConnection = adaptBaileysConnectionUpdate({
      ...context,
      observedAt,
      raw: { connection: "open" }
    });
    const metaConnection = adaptMetaConnectionUpdate({
      ...context,
      observedAt,
      raw: { state: "connected", phone_number_id: "phone-number-1" }
    });

    expect(baileysChat.eventType).toBe("chat.updated");
    expect(metaChat.eventType).toBe("chat.updated");
    expect(baileysChat.payload.chat).toEqual(metaChat.payload.chat);
    expect(baileysChat.chatState).toEqual(metaChat.chatState);
    expect(adaptBaileysChatUpdate(baileysChatInput).aggregateId).toBe(
      baileysChat.aggregateId
    );
    expect(baileysConnection.eventType).toBe("connection.updated");
    expect(metaConnection.eventType).toBe("connection.updated");
    expect(baileysConnection.payload.connection).toEqual({
      id: 42,
      publicId: null,
      state: "connected",
      phoneNumber: null
    });
    expect(metaConnection.payload.connection).toEqual({
      id: 42,
      publicId: "phone-number-1",
      state: "connected",
      phoneNumber: null
    });
  });

  it("registers Baileys chat/connection listeners that publish through the mirror facade path", async () => {
    const handlers = new Map<string, (value: any) => Promise<void>>();
    const publish = jest.fn().mockResolvedValue(undefined);
    registerBaileysMirrorLifecycleListeners(
      {
        ev: {
          on: (event: string, handler: (value: any) => Promise<void>) => {
            handlers.set(event, handler);
          }
        }
      },
      context,
      publish,
      () => new Date("2024-07-26T13:20:04.000Z")
    );

    await handlers.get("chats.update")?.([
      {
        id: "5511999999999@s.whatsapp.net",
        conversationTimestamp: 1_722_000_004,
        unreadCount: 1
      }
    ]);
    await handlers.get("connection.update")?.({ connection: "open" });

    expect(publish).toHaveBeenNthCalledWith(
      1,
      [expect.objectContaining({ eventType: "chat.updated" })]
    );
    expect(publish).toHaveBeenNthCalledWith(
      2,
      [expect.objectContaining({ eventType: "connection.updated" })]
    );
  });

  it("extracts Meta connection and chat lifecycle points with null-complete provider DTOs", () => {
    const events = adaptMetaLifecycleEvents({
      ...context,
      observedAt: new Date("2024-07-26T13:20:04.000Z"),
      payload: {
        entry: [
          {
            changes: [
              {
                field: "account_update",
                value: {
                  state: "connected",
                  phone_number_id: "phone-number-1",
                  timestamp: "1722000004"
                }
              },
              {
                field: "messages",
                value: {
                  chats: [
                    {
                      jid: "5511999999999@s.whatsapp.net",
                      timestamp: "1722000004",
                      unread_count: 1
                    }
                  ]
                }
              }
            ]
          }
        ]
      }
    });

    expect(events.map(event => event.eventType)).toEqual([
      "connection.updated",
      "chat.updated"
    ]);
    expect(events[0].payload.connection).toEqual({
      id: 42,
      publicId: "phone-number-1",
      state: "connected",
      phoneNumber: null
    });
    expect(events[1].payload.chat).toEqual(
      expect.objectContaining({
        jid: "5511999999999@s.whatsapp.net",
        lid: null,
        name: null,
        unreadCount: 1
      })
    );
  });
});
