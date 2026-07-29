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

  it("keeps the opaque native-flow paramsJson id and emits received plus clicked", () => {
    const events = adaptBaileysMessageEvents({
      ...context,
      raw: {
        key: {
          id: "native-flow-1",
          remoteJid: "5511999999999@s.whatsapp.net",
          fromMe: false
        },
        messageTimestamp: 1_722_000_000,
        message: {
          interactiveResponseMessage: {
            nativeFlowResponseMessage: {
              paramsJson: JSON.stringify({
                id: "route:v2/accept?offer=opaque-9"
              })
            }
          }
        }
      }
    });

    expect(events.map(event => event.eventType)).toEqual([
      "message.received",
      "button.clicked"
    ]);
    expect(events[1].payload.message.interactive).toEqual({
      type: "button",
      id: "route:v2/accept?offer=opaque-9",
      title: null,
      description: null
    });
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

  it("preserves partial chat update presence without inventing state or phone numbers", () => {
    const observedAt = new Date("2024-07-26T13:20:04.000Z");
    const baileys = adaptBaileysChatUpdate({
      ...context,
      observedAt,
      raw: {
        id: "120363000000000000@g.us",
        archived: true
      }
    });
    const meta = adaptMetaChatUpdate({
      ...context,
      observedAt,
      raw: {
        jid: "123456789@lid",
        pinned: true
      }
    });

    expect(baileys.payload.chat).toMatchObject({
      archived: true,
      pinned: null,
      mutedUntil: null,
      unreadCount: null
    });
    expect(baileys.chatState).toMatchObject({ archived: true });
    expect(baileys.chatState).not.toHaveProperty("pinned");
    expect(baileys.chatState).not.toHaveProperty("mutedUntil");
    expect(baileys.chatState).not.toHaveProperty("unreadCount");
    expect(baileys.chatState).not.toHaveProperty("lastMessageId");
    expect(baileys.payload.contact.phoneNumber).toBeNull();

    expect(meta.payload.chat).toMatchObject({
      archived: null,
      pinned: true,
      mutedUntil: null,
      unreadCount: null
    });
    expect(meta.chatState).toMatchObject({ pinned: true });
    expect(meta.chatState).not.toHaveProperty("archived");
    expect(meta.chatState).not.toHaveProperty("mutedUntil");
    expect(meta.chatState).not.toHaveProperty("unreadCount");
    expect(meta.chatState).not.toHaveProperty("lastMessageId");
    expect(meta.payload.contact.phoneNumber).toBeNull();
  });

  it.each([
    {
      provider: "baileys",
      repeated: (observedAt: Date) =>
        adaptBaileysChatUpdate({
          ...context,
          observedAt,
          raw: { id: "5511999999999@s.whatsapp.net", archived: true }
        }),
      changed: (observedAt: Date) =>
        adaptBaileysChatUpdate({
          ...context,
          observedAt,
          raw: { id: "5511999999999@s.whatsapp.net", archived: false }
        })
    },
    {
      provider: "meta",
      repeated: (observedAt: Date) =>
        adaptMetaChatUpdate({
          ...context,
          observedAt,
          raw: { jid: "5511999999999@s.whatsapp.net", archived: true }
        }),
      changed: (observedAt: Date) =>
        adaptMetaChatUpdate({
          ...context,
          observedAt,
          raw: { jid: "5511999999999@s.whatsapp.net", archived: false }
        })
    }
  ])(
    "deduplicates $provider lifecycle retries across wall-clock time and distinguishes same-timestamp state",
    ({ repeated, changed }) => {
      const first = repeated(new Date("2024-07-26T13:20:04.000Z"));
      const retry = repeated(new Date("2024-07-26T14:20:04.000Z"));
      const distinct = changed(new Date("2024-07-26T13:20:04.000Z"));

      expect(retry.aggregateId).toBe(first.aggregateId);
      expect(distinct.aggregateId).not.toBe(first.aggregateId);
    }
  );

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

  it("publishes protocol and revoke-stub deletes through the registered listener before legacy filtering", async () => {
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

    await handlers.get("messages.upsert")?.({
      messages: [
        {
          key: {
            id: "revoke-event-1",
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
        {
          key: {
            id: "revoke-stub-target-2",
            remoteJid: "5511999999999@s.whatsapp.net",
            fromMe: false
          },
          messageTimestamp: 1_722_000_004,
          messageStubType: 1,
          messageStubParameters: ["target-message-2"]
        }
      ]
    });

    const deleted = publish.mock.calls[0][0];
    expect(deleted).toHaveLength(2);
    expect(deleted.map(event => event.eventType)).toEqual([
      "message.deleted",
      "message.deleted"
    ]);
    expect(deleted.map(event => event.payload.message.delete)).toEqual([
      expect.objectContaining({ targetMessageId: "target-message-1" }),
      expect.objectContaining({ targetMessageId: "target-message-2" })
    ]);

    publish.mockClear();
    await handlers.get("messages.update")?.([
      {
        key: {
          id: "revoke-update-3",
          remoteJid: "5511999999999@s.whatsapp.net",
          fromMe: false
        },
        update: {
          messageTimestamp: 1_722_000_005,
          message: {
            protocolMessage: {
              key: { id: "target-message-3" },
              type: 0
            }
          }
        }
      }
    ]);
    expect(
      publish.mock.calls[0][0][0].payload.message.delete
    ).toEqual(
      expect.objectContaining({ targetMessageId: "target-message-3" })
    );
  });

  it("uses stable Meta callback indices as lifecycle source identities", () => {
    const payload = {
      entry: [
        {
          id: "business-account-1",
          changes: [
            {
              field: "account_update",
              value: { state: "connected" }
            }
          ]
        }
      ]
    };
    const first = adaptMetaLifecycleEvents({
      ...context,
      observedAt: new Date("2024-07-26T13:20:04.000Z"),
      payload
    });
    const retry = adaptMetaLifecycleEvents({
      ...context,
      observedAt: new Date("2024-07-27T13:20:04.000Z"),
      payload
    });

    expect(retry[0].aggregateId).toBe(first[0].aggregateId);
    expect(first[0].payload.provider.eventId).toContain(
      "source:business-account-1:0:account_update"
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
