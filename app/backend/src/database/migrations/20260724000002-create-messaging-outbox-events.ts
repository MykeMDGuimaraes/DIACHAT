import { DataTypes, QueryInterface } from "sequelize";

const table = { tableName: "MessagingOutboxEvents", schema: "messaging" };

module.exports = {
  up: async (queryInterface: QueryInterface) => {
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
      eventType: { type: DataTypes.STRING, allowNull: false },
      aggregateId: { type: DataTypes.STRING, allowNull: false },
      payload: { type: DataTypes.JSONB, allowNull: false },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "ready"
      },
      attemptCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      availableAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      },
      leaseExpiresAt: { type: DataTypes.DATE, allowNull: true },
      lastError: { type: DataTypes.TEXT, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });

    await queryInterface.addIndex(
      table,
      ["status", "availableAt", "leaseExpiresAt"],
      { name: "messaging_outbox_dispatch_index" }
    );
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable(table);
  }
};
