import { DataTypes, QueryInterface } from "sequelize";

const table = { tableName: "MetaCloudCredentials", schema: "messaging" };

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn(table, "graphVersion", {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: process.env.META_GRAPH_VERSION || "v23.0"
    });
    await queryInterface.addColumn(table, "revokedAt", {
      type: DataTypes.DATE,
      allowNull: true
    });
  },
  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn(table, "revokedAt");
    await queryInterface.removeColumn(table, "graphVersion");
  }
};
