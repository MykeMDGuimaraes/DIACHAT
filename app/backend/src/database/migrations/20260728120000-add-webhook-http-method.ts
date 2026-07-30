import { DataTypes, QueryInterface } from "sequelize";

const subscriptions = { tableName: "WebhookSubscriptions", schema: "messaging" };
const deliveries = { tableName: "WebhookDeliveries", schema: "messaging" };

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    // Idempotente: a sincronização de schema do publish (dev→prod) pode já ter
    // adicionado estas colunas sem registrar esta migração.
    const subscriptionsDesc = await queryInterface.describeTable(subscriptions);
    if (!subscriptionsDesc.method) {
      await queryInterface.addColumn(subscriptions, "method", {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "POST"
      });
    }
    const deliveriesDesc = await queryInterface.describeTable(deliveries);
    if (!deliveriesDesc.methodSnapshot) {
      await queryInterface.addColumn(deliveries, "methodSnapshot", {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "POST"
      });
    }
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.removeColumn(deliveries, "methodSnapshot");
    await queryInterface.removeColumn(subscriptions, "method");
  }
};
