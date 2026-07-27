import { DataTypes, QueryInterface } from "sequelize";

const table = { tableName: "MessagingInboxEvents", schema: "messaging" };

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable(table, {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
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
      dedupeKey: { type: DataTypes.STRING, allowNull: false },
      payload: { type: DataTypes.JSONB, allowNull: false },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "received"
      },
      processedAt: { type: DataTypes.DATE, allowNull: true },
      lastError: { type: DataTypes.TEXT, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex(table, ["dedupeKey"], {
      name: "messaging_inbox_events_dedupe_key_unique",
      unique: true
    });
    await queryInterface.addIndex(table, ["status", "createdAt"], {
      name: "messaging_inbox_events_status_created_at"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable(table);
  }
};
