import { DataTypes, QueryInterface } from "sequelize";

const table = { tableName: "MessagingInboxEvents", schema: "messaging" };

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.addColumn(table, "attemptCount", {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    });
    await queryInterface.addColumn(table, "leaseExpiresAt", {
      type: DataTypes.DATE,
      allowNull: true
    });
  },
  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.removeColumn(table, "leaseExpiresAt");
    await queryInterface.removeColumn(table, "attemptCount");
  }
};
