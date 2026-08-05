import { DataTypes, QueryInterface, QueryTypes } from "sequelize";

const table = { tableName: "WhatsAppSessionKeys", schema: "messaging" };

// Armazenamento por chave do auth-state (Hardening T6): uma row por id de
// chave de sinal, payload SEMPRE criptografado (cipher de mensageria) e
// fencing por (generation, revision) — uma escrita vencida nunca sobrescreve
// um registro mais novo.
const sessionKeyColumns = {
  whatsappId: { type: DataTypes.INTEGER, primaryKey: true, allowNull: false },
  keyType: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  keyId: { type: DataTypes.TEXT, primaryKey: true, allowNull: false },
  ciphertext: { type: DataTypes.TEXT, allowNull: false },
  revision: { type: DataTypes.BIGINT, allowNull: false },
  generation: { type: DataTypes.BIGINT, allowNull: false },
  createdAt: { type: DataTypes.DATE, allowNull: false },
  updatedAt: { type: DataTypes.DATE, allowNull: false }
};

// Guards de idempotencia (mesmo padrao da migracao 20260804000000): o sync de
// schema dev->prod do publish pode criar a tabela antes desta migration.
const tableExists = async (
  queryInterface: QueryInterface
): Promise<boolean> => {
  const rows = (await queryInterface.sequelize.query(
    'SELECT to_regclass(\'messaging."WhatsAppSessionKeys"\') AS "regclass"',
    { type: QueryTypes.SELECT }
  )) as Array<{ regclass: string | null }>;
  return rows.length > 0 && rows[0].regclass !== null;
};

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    if (!(await tableExists(queryInterface))) {
      await queryInterface.createTable(table, sessionKeyColumns);
    } else {
      // Drift parcial: repara colunas ausentes.
      const existing = await queryInterface.describeTable(table);
      for (const [column, definition] of Object.entries(sessionKeyColumns)) {
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
