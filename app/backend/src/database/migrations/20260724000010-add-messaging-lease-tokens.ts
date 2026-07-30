import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn(
      { tableName: "MessageCommands", schema: "messaging" },
      "leaseToken",
      { type: DataTypes.UUID, allowNull: true }
    );
    await queryInterface.addColumn(
      { tableName: "MessagingOutboxEvents", schema: "messaging" },
      "leaseToken",
      { type: DataTypes.UUID, allowNull: true }
    );
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn(
      { tableName: "MessageCommands", schema: "messaging" },
      "leaseToken"
    );
    await queryInterface.removeColumn(
      { tableName: "MessagingOutboxEvents", schema: "messaging" },
      "leaseToken"
    );
  }
};
