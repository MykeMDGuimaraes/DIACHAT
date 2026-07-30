const migration = require("../20260729000000-add-whatsapp-mirror-snapshots");

export {};

describe("WhatsApp mirror snapshot migration", () => {
  it("adds encrypted body metadata, delivery fencing indexes, and durable chat state", async () => {
    const addColumn = jest.fn();
    const createTable = jest.fn();
    const addIndex = jest.fn();

    // Simula banco limpo (sem drift): nenhuma coluna/tabela/índice existe,
    // então todos os guards deixam as operações executarem.
    await migration.up({
      addColumn,
      createTable,
      addIndex,
      describeTable: jest.fn().mockResolvedValue({}),
      sequelize: { query: jest.fn().mockResolvedValue([]) }
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

  it("repairs missing columns when the chat state table already exists (partial drift)", async () => {
    const addColumn = jest.fn();
    const createTable = jest.fn();
    const addIndex = jest.fn();
    // Tabela WhatsAppChatStates existe mas vazia de colunas (drift parcial);
    // outbox/deliveries já têm todas as colunas; nenhum índice existe.
    const describeTable = jest.fn(async (table: { tableName: string }) =>
      table.tableName === "WhatsAppChatStates"
        ? {}
        : {
            leaseToken: {},
            bodyCiphertext: {},
            bodyKeyVersion: {},
            bodySha256: {},
            bodyExpiresAt: {},
            bodyPurgedAt: {}
          }
    );
    const query = jest.fn(async (sql: string) =>
      sql.includes("to_regclass")
        ? [{ regclass: "messaging.WhatsAppChatStates" }]
        : []
    );

    await migration.up({
      addColumn,
      createTable,
      addIndex,
      describeTable,
      sequelize: { query }
    });

    expect(createTable).not.toHaveBeenCalled();
    expect(addColumn).toHaveBeenCalledWith(
      { tableName: "WhatsAppChatStates", schema: "messaging" },
      "jid",
      expect.any(Object)
    );
    expect(addColumn).toHaveBeenCalledWith(
      { tableName: "WhatsAppChatStates", schema: "messaging" },
      "revision",
      expect.any(Object)
    );
    expect(addIndex).toHaveBeenCalledWith(
      { tableName: "WhatsAppChatStates", schema: "messaging" },
      ["companyId", "whatsappId", "jid"],
      expect.objectContaining({
        name: "whatsapp_chat_states_company_connection_jid_unique"
      })
    );
  });

  it("reverses only the additive Task 2 schema", async () => {
    const removeIndex = jest.fn();
    const dropTable = jest.fn();
    const removeColumn = jest.fn();

    // Simula banco no estado pós-up: tabela e colunas existem, então os
    // guards do down() deixam a reversão executar por completo.
    const existingColumns = {
      leaseToken: {},
      bodyCiphertext: {},
      bodyKeyVersion: {},
      bodySha256: {},
      bodyExpiresAt: {},
      bodyPurgedAt: {}
    };
    await migration.down({
      removeIndex,
      dropTable,
      removeColumn,
      describeTable: jest.fn().mockResolvedValue(existingColumns),
      sequelize: {
        query: jest.fn().mockResolvedValue([
          { regclass: "messaging.WhatsAppChatStates", found: 1 }
        ])
      }
    });

    expect(dropTable).toHaveBeenCalledWith({
      tableName: "WhatsAppChatStates",
      schema: "messaging"
    });
    expect(removeColumn).toHaveBeenCalledTimes(11);
  });
});
