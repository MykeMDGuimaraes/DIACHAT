import { Sequelize } from "sequelize-typescript";
import MessagingOutboxEvent from "../MessagingOutboxEvent";
import WebhookDelivery from "../WebhookDelivery";
import WhatsAppChatState from "../WhatsAppChatState";

describe("WhatsApp mirror persistence models", () => {
  it("maps encrypted snapshot and delivery fencing metadata", () => {
    const sequelize = new Sequelize({ dialect: "postgres", logging: false });
    sequelize.addModels([
      MessagingOutboxEvent,
      WebhookDelivery,
      WhatsAppChatState
    ]);

    for (const model of [MessagingOutboxEvent, WebhookDelivery]) {
      expect(model.rawAttributes).toEqual(
        expect.objectContaining({
          bodyCiphertext: expect.any(Object),
          bodyKeyVersion: expect.any(Object),
          bodySha256: expect.any(Object),
          bodyExpiresAt: expect.any(Object),
          bodyPurgedAt: expect.any(Object)
        })
      );
    }
    expect(WebhookDelivery.rawAttributes).toEqual(
      expect.objectContaining({ leaseToken: expect.any(Object) })
    );
  });

  it("maps company/connection/JID chat state and its revision fields", () => {
    const sequelize = new Sequelize({ dialect: "postgres", logging: false });
    sequelize.addModels([WhatsAppChatState]);

    expect(WhatsAppChatState.getTableName()).toMatchObject({
      tableName: "WhatsAppChatStates",
      schema: "messaging"
    });
    expect(WhatsAppChatState.rawAttributes).toEqual(
      expect.objectContaining({
        companyId: expect.any(Object),
        whatsappId: expect.any(Object),
        jid: expect.any(Object),
        lid: expect.any(Object),
        isGroup: expect.any(Object),
        archived: expect.any(Object),
        pinned: expect.any(Object),
        mutedUntil: expect.any(Object),
        unreadCount: expect.any(Object),
        lastMessageId: expect.any(Object),
        lastMessageAt: expect.any(Object),
        lastMessagePreview: expect.any(Object),
        revision: expect.any(Object)
      })
    );
    expect(WhatsAppChatState.options.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "whatsapp_chat_states_company_connection_jid_unique",
          unique: true,
          fields: ["companyId", "whatsappId", "jid"]
        })
      ])
    );
  });
});
