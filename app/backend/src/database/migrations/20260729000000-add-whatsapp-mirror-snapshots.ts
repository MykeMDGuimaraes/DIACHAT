import { DataTypes, QueryInterface, QueryTypes } from "sequelize";

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

const encryptedBodyColumns = {
  bodyCiphertext: { type: DataTypes.TEXT, allowNull: true },
  bodyKeyVersion: { type: DataTypes.STRING, allowNull: true },
  bodySha256: { type: DataTypes.STRING(64), allowNull: true },
  bodyExpiresAt: { type: DataTypes.DATE, allowNull: true },
  bodyPurgedAt: { type: DataTypes.DATE, allowNull: true }
};

const chatStatesColumns = {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    allowNull: false
  },
  companyId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: { tableName: "Companies", schema: "public" },
      key: "id"
    },
    onDelete: "CASCADE",
    onUpdate: "CASCADE"
  },
  whatsappId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: { tableName: "Whatsapps", schema: "public" },
      key: "id"
    },
    onDelete: "CASCADE",
    onUpdate: "CASCADE"
  },
  jid: { type: DataTypes.STRING(191), allowNull: false },
  lid: { type: DataTypes.STRING(191), allowNull: true },
  isGroup: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  archived: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  pinned: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  mutedUntil: { type: DataTypes.DATE, allowNull: true },
  unreadCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  lastMessageId: { type: DataTypes.STRING, allowNull: true },
  lastMessageAt: { type: DataTypes.DATE, allowNull: true },
  lastMessagePreview: { type: DataTypes.TEXT, allowNull: true },
  revision: {
    type: DataTypes.BIGINT,
    allowNull: false,
    defaultValue: 0
  },
  createdAt: { type: DataTypes.DATE, allowNull: false },
  updatedAt: { type: DataTypes.DATE, allowNull: false }
};

// Guards de idempotência: o sync de schema dev->prod do publish pode criar
// colunas/tabelas antes das migrações rodarem; sem guards, addColumn/
// createTable/addIndex duplicados derrubam o boot no publish.
const tableExists = async (
  queryInterface: QueryInterface,
  schema: string,
  tableName: string
): Promise<boolean> => {
  const rows = (await queryInterface.sequelize.query(
    `SELECT to_regclass('${schema}."${tableName}"') AS "regclass"`,
    { type: QueryTypes.SELECT }
  )) as Array<{ regclass: string | null }>;
  return rows.length > 0 && rows[0].regclass !== null;
};

const indexExists = async (
  queryInterface: QueryInterface,
  schema: string,
  indexName: string
): Promise<boolean> => {
  const rows = (await queryInterface.sequelize.query(
    `SELECT 1 AS "found" FROM pg_indexes WHERE schemaname = :schema AND indexname = :indexName`,
    {
      type: QueryTypes.SELECT,
      replacements: { schema, indexName }
    }
  )) as Array<{ found: number }>;
  return rows.length > 0;
};

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const outboxColumns = await queryInterface.describeTable(outbox);
    const deliveriesColumns = await queryInterface.describeTable(deliveries);

    for (const [column, definition] of Object.entries(encryptedBodyColumns)) {
      if (!outboxColumns[column]) {
        await queryInterface.addColumn(outbox, column, definition);
      }
      if (!deliveriesColumns[column]) {
        await queryInterface.addColumn(deliveries, column, definition);
      }
    }
    if (!deliveriesColumns.leaseToken) {
      await queryInterface.addColumn(deliveries, "leaseToken", {
        type: DataTypes.UUID,
        allowNull: true
      });
    }

    if (
      !(await tableExists(queryInterface, "messaging", "WhatsAppChatStates"))
    ) {
      await queryInterface.createTable(chatStates, chatStatesColumns);
    } else {
      // Drift parcial: a tabela já existe (ex.: sync do publish a criou) mas
      // pode estar incompleta — repara colunas ausentes antes dos índices.
      const chatStatesExisting = await queryInterface.describeTable(
        chatStates
      );
      for (const [column, definition] of Object.entries(chatStatesColumns)) {
        if (!chatStatesExisting[column]) {
          await queryInterface.addColumn(chatStates, column, definition);
        }
      }
    }

    if (
      !(await indexExists(
        queryInterface,
        "messaging",
        "whatsapp_chat_states_company_connection_jid_unique"
      ))
    ) {
      await queryInterface.addIndex(
        chatStates,
        ["companyId", "whatsappId", "jid"],
        {
          name: "whatsapp_chat_states_company_connection_jid_unique",
          unique: true
        }
      );
    }
    if (
      !(await indexExists(
        queryInterface,
        "messaging",
        "webhook_deliveries_fenced_dispatch"
      ))
    ) {
      await queryInterface.addIndex(
        deliveries,
        ["status", "availableAt", "leaseExpiresAt", "leaseToken"],
        { name: "webhook_deliveries_fenced_dispatch" }
      );
    }
    if (
      !(await indexExists(
        queryInterface,
        "messaging",
        "webhook_deliveries_body_expiry"
      ))
    ) {
      await queryInterface.addIndex(
        deliveries,
        ["bodyExpiresAt", "bodyPurgedAt"],
        { name: "webhook_deliveries_body_expiry" }
      );
    }
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    if (
      await indexExists(
        queryInterface,
        "messaging",
        "webhook_deliveries_body_expiry"
      )
    ) {
      await queryInterface.removeIndex(
        deliveries,
        "webhook_deliveries_body_expiry"
      );
    }
    if (
      await indexExists(
        queryInterface,
        "messaging",
        "webhook_deliveries_fenced_dispatch"
      )
    ) {
      await queryInterface.removeIndex(
        deliveries,
        "webhook_deliveries_fenced_dispatch"
      );
    }
    if (await tableExists(queryInterface, "messaging", "WhatsAppChatStates")) {
      await queryInterface.dropTable(chatStates);
    }
    const deliveriesColumns = await queryInterface.describeTable(deliveries);
    if (deliveriesColumns.leaseToken) {
      await queryInterface.removeColumn(deliveries, "leaseToken");
    }
    const outboxColumns = await queryInterface.describeTable(outbox);
    for (const column of Object.keys(encryptedBodyColumns).reverse()) {
      if (deliveriesColumns[column]) {
        await queryInterface.removeColumn(deliveries, column);
      }
      if (outboxColumns[column]) {
        await queryInterface.removeColumn(outbox, column);
      }
    }
  }
};
