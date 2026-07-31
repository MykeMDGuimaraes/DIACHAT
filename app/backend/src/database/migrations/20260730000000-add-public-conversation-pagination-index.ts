import { QueryInterface, QueryTypes } from "sequelize";

const table = { tableName: "WhatsAppChatStates", schema: "messaging" };
const indexName = "whatsapp_chat_states_public_cursor";

// Guard de idempotencia: o sync de schema dev->prod do publish pode criar o
// indice antes desta migration executar. Sem a verificacao, um addIndex
// duplicado derruba o boot em producao (mesmo padrao das migracoes
// 20260728000012/13 e 20260729000000/01).
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
    if (!(await indexExists(queryInterface))) {
      await queryInterface.addIndex(
        table,
        ["companyId", "whatsappId", "lastMessageAt", "id"],
        { name: indexName }
      );
    }
  },
  down: async (queryInterface: QueryInterface): Promise<void> => {
    if (await indexExists(queryInterface)) {
      await queryInterface.removeIndex(table, indexName);
    }
  }
};
