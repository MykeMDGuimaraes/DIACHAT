const migration = require("../20260729000000-add-whatsapp-mirror-snapshots");

export {};

describe("WhatsApp mirror snapshot migration", () => {
  it("adds encrypted body metadata, delivery fencing indexes, and durable chat state", async () => {
    const addColumn = jest.fn();
    const createTable = jest.fn();
    const addIndex = jest.fn();

    await migration.up({
      addColumn,
      createTable,
      addIndex
    });

    const outbox = {
      tableName: "MessagingOutboxEvents",
      schema: "messaging"
    };
    const deliveries = {
      tableName: "WebhookDeliveries",
      schema: "messaging"
    };
    const chatStates = {
      tableName: "WhatsAppChatStates",
      schema: "messaging"
    };

    for (const column of [
      "bodyCiphertext",
      "bodyKeyVersion",
      "bodySha256",
      "bodyExpiresAt",
      "bodyPurgedAt"
    ]) {
      expect(addColumn).toHaveBeenCalledWith(
        outbox,
        column,
        expect.objectContaining({ allowNull: true })
      );
      expect(addColumn).toHaveBeenCalledWith(
        deliveries,
        column,
        expect.objectContaining({ allowNull: true })
      );
    }
    expect(addColumn).toHaveBeenCalledWith(
      deliveries,
      "leaseToken",
      expect.objectContaining({ allowNull: true })
    );
    expect(createTable).toHaveBeenCalledWith(
      chatStates,
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
        revision: expect.any(Object)
      })
    );
    expect(addIndex).toHaveBeenCalledWith(
      chatStates,
      ["companyId", "whatsappId", "jid"],
      expect.objectContaining({
        name: "whatsapp_chat_states_company_connection_jid_unique",
        unique: true
      })
    );
    expect(addIndex).toHaveBeenCalledWith(
      deliveries,
      ["status", "availableAt", "leaseExpiresAt", "leaseToken"],
      expect.objectContaining({
        name: "webhook_deliveries_fenced_dispatch"
      })
    );
    expect(addIndex).toHaveBeenCalledWith(
      deliveries,
      ["bodyExpiresAt", "bodyPurgedAt"],
      expect.objectContaining({
        name: "webhook_deliveries_body_expiry"
      })
    );
  });

  it("reverses only the additive Task 2 schema", async () => {
    const removeIndex = jest.fn();
    const dropTable = jest.fn();
    const removeColumn = jest.fn();

    await migration.down({
      removeIndex,
      dropTable,
      removeColumn
    });

    expect(dropTable).toHaveBeenCalledWith({
      tableName: "WhatsAppChatStates",
      schema: "messaging"
    });
    expect(removeColumn).toHaveBeenCalledTimes(11);
  });
});
