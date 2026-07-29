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

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn(messageCommands, "externalTicketId", {
      type: DataTypes.STRING,
      allowNull: true
    });
    await queryInterface.addColumn(messageCommands, "automationEpoch", {
      type: DataTypes.INTEGER,
      allowNull: true
    });
    await queryInterface.addColumn(messageCommands, "conversationId", {
      type: DataTypes.STRING,
      allowNull: true
    });
    await queryInterface.addColumn(messageCommands, "contactId", {
      type: DataTypes.STRING,
      allowNull: true
    });
    await queryInterface.addColumn(messageCommands, "responseSnapshot", {
      type: DataTypes.JSONB,
      allowNull: true
    });
    await queryInterface.addColumn(messageCommands, "cancelledAt", {
      type: DataTypes.DATE,
      allowNull: true
    });
    await queryInterface.addIndex(
      messageCommands,
      ["companyId", "externalTicketId", "automationEpoch", "status"],
      { name: "message_commands_router_correlation" }
    );

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
    await queryInterface.addIndex(
      automationStates,
      ["companyId", "externalTicketId"],
      {
        name: "conversation_automation_external_ticket_unique",
        unique: true
      }
    );
    await queryInterface.addIndex(
      automationStates,
      ["companyId", "conversationId"],
      { name: "conversation_automation_conversation_unique", unique: true }
    );

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
    await queryInterface.addIndex(
      conversationCommands,
      ["companyId", "idempotencyScope", "idempotencyKey"],
      { name: "conversation_commands_idempotency_unique", unique: true }
    );
    await queryInterface.addIndex(
      conversationCommands,
      ["status", "leaseExpiresAt"],
      { name: "conversation_commands_dispatch" }
    );
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable(conversationCommands);
    await queryInterface.dropTable(automationStates);
    await queryInterface.removeColumn(messageCommands, "cancelledAt");
    await queryInterface.removeColumn(messageCommands, "responseSnapshot");
    await queryInterface.removeColumn(messageCommands, "contactId");
    await queryInterface.removeColumn(messageCommands, "conversationId");
    await queryInterface.removeColumn(messageCommands, "automationEpoch");
    await queryInterface.removeColumn(messageCommands, "externalTicketId");
  }
};
