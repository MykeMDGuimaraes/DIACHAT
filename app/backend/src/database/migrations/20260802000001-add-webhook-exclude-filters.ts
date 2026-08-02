import { DataTypes, QueryInterface } from "sequelize";

const table = { tableName: "WebhookSubscriptions", schema: "messaging" };

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const columns = await queryInterface.describeTable(table);
    if (!columns.excludeFilters) {
      await queryInterface.addColumn(table, "excludeFilters", {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
      });
    }
  },
  down: async (queryInterface: QueryInterface): Promise<void> => {
    const columns = await queryInterface.describeTable(table);
    if (columns.excludeFilters) {
      await queryInterface.removeColumn(table, "excludeFilters");
    }
  }
};
