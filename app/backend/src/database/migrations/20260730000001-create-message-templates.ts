import { DataTypes, QueryInterface, QueryTypes } from "sequelize";

const table = { tableName: "MessageTemplates", schema: "messaging" };
const indexName = "message_templates_company_public_unique";

const templateColumns = {
  id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
  companyId: { type: DataTypes.INTEGER, allowNull: false },
  publicId: { type: DataTypes.UUID, allowNull: false },
  name: { type: DataTypes.STRING(120), allowNull: false },
  content: { type: DataTypes.TEXT, allowNull: false },
  variables: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: []
  },
  version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  createdBy: { type: DataTypes.INTEGER, allowNull: true },
  createdAt: { type: DataTypes.DATE, allowNull: false },
  updatedAt: { type: DataTypes.DATE, allowNull: false }
};

// Guards de idempotencia: o sync de schema dev->prod do publish pode criar a
// tabela/indice antes desta migration executar (mesmo padrao das migracoes
// 20260728000012/13 e 20260729000000/01). Rollback e ferramenta manual de
// desenvolvimento; o publish nunca executa down().
const tableExists = async (
  queryInterface: QueryInterface
): Promise<boolean> => {
  const rows = (await queryInterface.sequelize.query(
    `SELECT to_regclass('messaging."MessageTemplates"') AS "regclass"`,
    { type: QueryTypes.SELECT }
  )) as Array<{ regclass: string | null }>;
  return rows.length > 0 && rows[0].regclass !== null;
};

const indexExists = async (
  queryInterface: QueryInterface
): Promise<boolean> => {
  const rows = await queryInterface.sequelize.query(
    `SELECT 1 AS "found" FROM pg_indexes
     WHERE schemaname = 'messaging' AND indexname = :indexName`,
    { replacements: { indexName }, type: QueryTypes.SELECT }
  );
  return rows.length > 0;
};

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    if (!(await tableExists(queryInterface))) {
      await queryInterface.createTable(table, templateColumns);
    } else {
      // Drift parcial: a tabela ja existe (ex.: sync do publish a criou) mas
      // pode estar incompleta — repara colunas ausentes antes do indice.
      const existing = await queryInterface.describeTable(table);
      for (const [column, definition] of Object.entries(templateColumns)) {
        if (!existing[column]) {
          await queryInterface.addColumn(table, column, definition);
        }
      }
    }

    if (!(await indexExists(queryInterface))) {
      await queryInterface.addIndex(table, ["companyId", "publicId"], {
        unique: true,
        name: indexName
      });
    }
  },
  down: async (queryInterface: QueryInterface): Promise<void> => {
    if (await indexExists(queryInterface)) {
      await queryInterface.removeIndex(table, indexName);
    }
    if (await tableExists(queryInterface)) {
      await queryInterface.dropTable(table);
    }
  }
};
