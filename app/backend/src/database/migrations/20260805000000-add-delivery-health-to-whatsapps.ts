import { DataTypes, QueryInterface } from "sequelize";

const table = { tableName: "Whatsapps", schema: "public" };

const healthColumns = {
  deliveryHealth: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "healthy"
  },
  deliveryHealthChangedAt: { type: DataTypes.DATE, allowNull: true },
  lastConfirmedDeliveryAt: { type: DataTypes.DATE, allowNull: true },
  consecutiveUnconfirmedDeliveries: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  lastDeliveryErrorCode: { type: DataTypes.STRING, allowNull: true },
  lastUnconfirmedDeliveryAt: { type: DataTypes.DATE, allowNull: true }
};

// Guards de idempotencia: o sync de schema dev->prod do publish pode criar as
// colunas antes desta migration executar (mesmo padrao das migracoes
// 20260728000012/13 e 20260730000001). Rollback e ferramenta manual de
// desenvolvimento; o publish nunca executa down().
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const existing = await queryInterface.describeTable(table);
    for (const [column, definition] of Object.entries(healthColumns)) {
      if (!existing[column]) {
        await queryInterface.addColumn(table, column, definition);
      }
    }
  },
  down: async (queryInterface: QueryInterface): Promise<void> => {
    const existing = await queryInterface.describeTable(table);
    for (const column of Object.keys(healthColumns)) {
      if (existing[column]) {
        await queryInterface.removeColumn(table, column);
      }
    }
  }
};
