import { DataTypes, QueryInterface } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    // Idempotente: a sincronização de schema do publish (dev→prod) pode já ter
    // adicionado estas colunas sem registrar esta migração.
    const companies = await queryInterface.describeTable("Companies");
    if (!companies.messagingRequestsPerMinute) {
      await queryInterface.addColumn("Companies", "messagingRequestsPerMinute", {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 60
      });
    }
    if (!companies.messagingUploadMbPerMinute) {
      await queryInterface.addColumn("Companies", "messagingUploadMbPerMinute", {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 100
      });
    }
  },
  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.removeColumn("Companies", "messagingUploadMbPerMinute");
    await queryInterface.removeColumn("Companies", "messagingRequestsPerMinute");
  }
};
