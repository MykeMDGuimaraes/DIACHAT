import { DataTypes, QueryInterface } from "sequelize";

const table = { tableName: "MessagingInboxEvents", schema: "messaging" };
const dispatchIndex = "messaging_inbox_events_dispatch";

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.addColumn(table, "availableAt", {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    });
    await queryInterface.addIndex(
      table,
      ["provider", "status", "availableAt", "createdAt"],
      { name: dispatchIndex }
    );
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.removeIndex(table, dispatchIndex);
    await queryInterface.removeColumn(table, "availableAt");
  }
};
