import { DataTypes, QueryInterface, QueryTypes } from "sequelize";

const table = { tableName: "MessagingRolloutCohorts", schema: "messaging" };
const INDEX_NAME = "messaging_rollout_cohorts_capability_company";

// Coortes de rollout por empresa (Hardening T9): permitem ativar uma
// capacidade (ex.: auth_store) em modo distinto para um subconjunto de
// empresas — base do canário 1 canal -> 10% -> 50% -> 100%. Ausência de row =
// default global (env).
const cohortColumns = {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false
  },
  capability: { type: DataTypes.STRING, allowNull: false },
  companyId: { type: DataTypes.INTEGER, allowNull: false },
  mode: { type: DataTypes.STRING, allowNull: false },
  createdAt: { type: DataTypes.DATE, allowNull: false },
  updatedAt: { type: DataTypes.DATE, allowNull: false }
};

// Guards de idempotencia (mesmo padrao das migracoes 20260804000000/500001):
// o sync de schema dev->prod do publish pode criar a tabela antes.
const tableExists = async (
  queryInterface: QueryInterface
): Promise<boolean> => {
  const rows = (await queryInterface.sequelize.query(
    'SELECT to_regclass(\'messaging."MessagingRolloutCohorts"\') AS "regclass"',
    { type: QueryTypes.SELECT }
  )) as Array<{ regclass: string | null }>;
  return rows.length > 0 && rows[0].regclass !== null;
};

const indexExists = async (
  queryInterface: QueryInterface
): Promise<boolean> => {
  const rows = (await queryInterface.sequelize.query(
    `SELECT to_regclass('messaging.${INDEX_NAME}') AS "regclass"`,
    { type: QueryTypes.SELECT }
  )) as Array<{ regclass: string | null }>;
  return rows.length > 0 && rows[0].regclass !== null;
};

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    if (!(await tableExists(queryInterface))) {
      await queryInterface.createTable(table, cohortColumns);
    } else {
      // Drift parcial: repara colunas ausentes.
      const existing = await queryInterface.describeTable(table);
      for (const [column, definition] of Object.entries(cohortColumns)) {
        if (!existing[column]) {
          await queryInterface.addColumn(table, column, definition);
        }
      }
    }
    if (!(await indexExists(queryInterface))) {
      await queryInterface.addIndex(table, {
        name: INDEX_NAME,
        unique: true,
        fields: ["capability", "companyId"]
      });
    }
  },
  down: async (queryInterface: QueryInterface): Promise<void> => {
    if (await tableExists(queryInterface)) {
      await queryInterface.dropTable(table);
    }
  }
};
