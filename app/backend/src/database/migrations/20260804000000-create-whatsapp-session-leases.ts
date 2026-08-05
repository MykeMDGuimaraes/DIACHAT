import { DataTypes, QueryInterface, QueryTypes } from "sequelize";

const table = { tableName: "WhatsAppSessionLeases", schema: "messaging" };

const leaseColumns = {
  whatsappId: { type: DataTypes.INTEGER, primaryKey: true, allowNull: false },
  ownerId: { type: DataTypes.UUID, allowNull: false },
  fencingToken: { type: DataTypes.BIGINT, allowNull: false },
  expiresAt: { type: DataTypes.DATE, allowNull: false },
  heartbeatAt: { type: DataTypes.DATE, allowNull: false },
  createdAt: { type: DataTypes.DATE, allowNull: false },
  updatedAt: { type: DataTypes.DATE, allowNull: false }
};

// Guards de idempotencia: o sync de schema dev->prod do publish pode criar a
// tabela antes desta migration executar (mesmo padrao das migracoes
// 20260728000012/13 e 20260730000001). Rollback e ferramenta manual de
// desenvolvimento; o publish nunca executa down().
const tableExists = async (
  queryInterface: QueryInterface
): Promise<boolean> => {
  const rows = (await queryInterface.sequelize.query(
    `SELECT to_regclass('messaging."WhatsAppSessionLeases"') AS "regclass"`,
    { type: QueryTypes.SELECT }
  )) as Array<{ regclass: string | null }>;
  return rows.length > 0 && rows[0].regclass !== null;
};

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    if (!(await tableExists(queryInterface))) {
      await queryInterface.createTable(table, leaseColumns);
    } else {
      // Drift parcial: a tabela ja existe (ex.: sync do publish a criou) mas
      // pode estar incompleta — repara colunas ausentes.
      const existing = await queryInterface.describeTable(table);
      for (const [column, definition] of Object.entries(leaseColumns)) {
        if (!existing[column]) {
          await queryInterface.addColumn(table, column, definition);
        }
      }
    }
  },
  down: async (queryInterface: QueryInterface): Promise<void> => {
    if (await tableExists(queryInterface)) {
      await queryInterface.dropTable(table);
    }
  }
};
