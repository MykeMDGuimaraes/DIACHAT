import { QueryInterface } from "sequelize";
const table = { tableName: "WhatsAppChatStates", schema: "messaging" };
const index = "whatsapp_chat_states_public_cursor";
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => { await queryInterface.addIndex(table, ["companyId", "whatsappId", "lastMessageAt", "id"], { name: index }); },
  down: async (queryInterface: QueryInterface): Promise<void> => { await queryInterface.removeIndex(table, index); }
};
