import { DataTypes, QueryInterface } from "sequelize";

const messageCommands = {
  tableName: "MessageCommands",
  schema: "messaging"
};
const automationStates = {
  tableName: "ConversationAutomationStates",
  schema: "messaging"
};
const conversationCommands = {
  tableName: "ConversationCommands",
  schema: "messaging"
};

// Guards tornam a migração idempotente: o sync de schema do publish pode
// adicionar colunas em tabelas existentes sem registrar no SequelizeMeta.
const hasIndex = async (
  queryInterface: QueryInterface,
  indexName: string
): Promise<boolean> => {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = 'messaging' AND indexname = '${indexName}'`
  );
  return rows.length > 0;
};

const hasTable = async (
  queryInterface: QueryInterface,
  tableName: string
): Promise<boolean> => {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT to_regclass('messaging."${tableName}"') AS regclass`
  );
  return Boolean((rows[0] as { regclass: string | null } | undefined)?.regclass);
};

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const existingColumns = await queryInterface.describeTable(messageCommands);
    if (!existingColumns.externalTicketId) {
      await queryInterface.addColumn(messageCommands, "externalTicketId", {
        type: DataTypes.STRING,
        allowNull: true
      });
    }
    if (!existingColumns.automationEpoch) {
      await queryInterface.addColumn(messageCommands, "automationEpoch", {
        type: DataTypes.INTEGER,
        allowNull: true
      });
    }
    if (!existingColumns.conversationId) {
      await queryInterface.addColumn(messageCommands, "conversationId", {
        type: DataTypes.STRING,
        allowNull: true
      });
    }
    if (!existingColumns.contactId) {
      await queryInterface.addColumn(messageCommands, "contactId", {
        type: DataTypes.STRING,
        allowNull: true
      });
    }
    if (!existingColumns.responseSnapshot) {
      await queryInterface.addColumn(messageCommands, "responseSnapshot", {
        type: DataTypes.JSONB,
        allowNull: true
      });
    }
    if (!existingColumns.cancelledAt) {
      await queryInterface.addColumn(messageCommands, "cancelledAt", {
        type: DataTypes.DATE,
        allowNull: true
      });
    }
    if (!(await hasIndex(queryInterface, "message_commands_router_correlation"))) {
      await queryInterface.addIndex(
        messageCommands,
        ["companyId", "externalTicketId", "automationEpoch", "status"],
        { name: "message_commands_router_correlation" }
      );
    }

    if (!(await hasTable(queryInterface, "ConversationAutomationStates"))) {
      await queryInterface.createTable(automationStates, {
        id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
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
        externalTicketId: { type: DataTypes.STRING, allowNull: false },
        conversationId: { type: DataTypes.STRING, allowNull: false },
        automationEpoch: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0
        },
        state: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: "automation"
        },
        createdAt: { type: DataTypes.DATE, allowNull: false },
        updatedAt: { type: DataTypes.DATE, allowNull: false }
      });
    }
    if (
      !(await hasIndex(
        queryInterface,
        "conversation_automation_external_ticket_unique"
      ))
    ) {
      await queryInterface.addIndex(
        automationStates,
        ["companyId", "externalTicketId"],
        {
          name: "conversation_automation_external_ticket_unique",
          unique: true
        }
      );
    }
    if (
      !(await hasIndex(
        queryInterface,
        "conversation_automation_conversation_unique"
      ))
    ) {
      await queryInterface.addIndex(
        automationStates,
        ["companyId", "conversationId"],
        { name: "conversation_automation_conversation_unique", unique: true }
      );
    }

    if (!(await hasTable(queryInterface, "ConversationCommands"))) {
      await queryInterface.createTable(conversationCommands, {
        id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
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
        conversationId: { type: DataTypes.STRING, allowNull: false },
        externalTicketId: { type: DataTypes.STRING, allowNull: false },
        automationEpoch: { type: DataTypes.INTEGER, allowNull: false },
        action: { type: DataTypes.STRING, allowNull: false },
        queueId: { type: DataTypes.STRING, allowNull: true },
        userId: { type: DataTypes.STRING, allowNull: true },
        sendNativeSurvey: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false
        },
        idempotencyScope: { type: DataTypes.STRING, allowNull: false },
        idempotencyKey: { type: DataTypes.STRING, allowNull: false },
        requestFingerprint: { type: DataTypes.STRING, allowNull: false },
        requestPayload: { type: DataTypes.JSONB, allowNull: false },
        responseSnapshot: { type: DataTypes.JSONB, allowNull: true },
        status: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: "queued"
        },
        attemptCount: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0
        },
        leaseExpiresAt: { type: DataTypes.DATE, allowNull: true },
        leaseToken: { type: DataTypes.UUID, allowNull: true },
        errorCode: { type: DataTypes.STRING, allowNull: true },
        errorDetails: { type: DataTypes.JSONB, allowNull: true },
        completedAt: { type: DataTypes.DATE, allowNull: true },
        createdAt: { type: DataTypes.DATE, allowNull: false },
        updatedAt: { type: DataTypes.DATE, allowNull: false }
      });
    }
    if (
      !(await hasIndex(queryInterface, "conversation_commands_idempotency_unique"))
    ) {
      await queryInterface.addIndex(
        conversationCommands,
        ["companyId", "idempotencyScope", "idempotencyKey"],
        { name: "conversation_commands_idempotency_unique", unique: true }
      );
    }
    if (!(await hasIndex(queryInterface, "conversation_commands_dispatch"))) {
      await queryInterface.addIndex(
        conversationCommands,
        ["status", "leaseExpiresAt"],
        { name: "conversation_commands_dispatch" }
      );
    }
  },

  down: async (queryInterface: QueryInterface) => {
    if (await hasTable(queryInterface, "ConversationCommands")) {
      await queryInterface.dropTable(conversationCommands);
    }
    if (await hasTable(queryInterface, "ConversationAutomationStates")) {
      await queryInterface.dropTable(automationStates);
    }
    const existingColumns = await queryInterface.describeTable(messageCommands);
    if (existingColumns.cancelledAt) {
      await queryInterface.removeColumn(messageCommands, "cancelledAt");
    }
    if (existingColumns.responseSnapshot) {
      await queryInterface.removeColumn(messageCommands, "responseSnapshot");
    }
    if (existingColumns.contactId) {
      await queryInterface.removeColumn(messageCommands, "contactId");
    }
    if (existingColumns.conversationId) {
      await queryInterface.removeColumn(messageCommands, "conversationId");
    }
    if (existingColumns.automationEpoch) {
      await queryInterface.removeColumn(messageCommands, "automationEpoch");
    }
    if (existingColumns.externalTicketId) {
      await queryInterface.removeColumn(messageCommands, "externalTicketId");
    }
  }
};
