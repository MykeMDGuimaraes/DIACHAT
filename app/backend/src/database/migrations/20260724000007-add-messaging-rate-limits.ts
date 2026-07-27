import { DataTypes, QueryInterface } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.addColumn("Companies", "messagingRequestsPerMinute", {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 60
    });
    await queryInterface.addColumn("Companies", "messagingUploadMbPerMinute", {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 100
    });
  },
  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.removeColumn("Companies", "messagingUploadMbPerMinute");
    await queryInterface.removeColumn("Companies", "messagingRequestsPerMinute");
  }
};
