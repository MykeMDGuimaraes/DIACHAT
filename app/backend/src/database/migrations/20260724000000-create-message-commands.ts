import { DataTypes, QueryInterface } from "sequelize";

const table = { tableName: "MessageCommands", schema: "messaging" };

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(
      "CREATE SCHEMA IF NOT EXISTS messaging;"
    );

    await queryInterface.createTable(table, {
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
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      whatsappId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: { tableName: "Whatsapps", schema: "public" },
          key: "id"
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      provider: { type: DataTypes.STRING, allowNull: false },
      messageKind: { type: DataTypes.STRING, allowNull: false },
      recipient: { type: DataTypes.STRING, allowNull: false },
      idempotencyScope: { type: DataTypes.STRING, allowNull: false },
      idempotencyKey: { type: DataTypes.STRING, allowNull: false },
      requestFingerprint: { type: DataTypes.STRING, allowNull: false },
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
      messageId: {
        type: DataTypes.STRING,
        allowNull: true,
        references: {
          model: { tableName: "Messages", schema: "public" },
          key: "id"
        },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      providerMessageId: { type: DataTypes.STRING, allowNull: true },
      errorCode: { type: DataTypes.STRING, allowNull: true },
      errorDetails: { type: DataTypes.JSONB, allowNull: true },
      requestPayload: { type: DataTypes.JSONB, allowNull: false },
      completedAt: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });

    await queryInterface.addIndex(
      table,
      ["companyId", "idempotencyScope", "idempotencyKey"],
      {
        name: "message_commands_idempotency_unique",
        unique: true
      }
    );
    await queryInterface.addIndex(table, ["status", "leaseExpiresAt"], {
      name: "message_commands_dispatch_index"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable(table);
    await queryInterface.sequelize.query("DROP SCHEMA IF EXISTS messaging;");
  }
};
