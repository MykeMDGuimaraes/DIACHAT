const migration = require("../20260730000000-add-public-conversation-pagination-index");

export {};

const table = { tableName: "WhatsAppChatStates", schema: "messaging" };
const columns = ["companyId", "whatsappId", "lastMessageAt", "id"];

describe("public conversation pagination migration", () => {
  it("adds and removes only the cursor index", async () => {
    const addIndex = jest.fn();
    const removeIndex = jest.fn();
    // up(): indice ausente -> cria; down(): indice presente -> remove.
    const missing = jest.fn().mockResolvedValue([]);
    const present = jest.fn().mockResolvedValue([{ found: 1 }]);

    await migration.up({ addIndex, sequelize: { query: missing } });
    await migration.down({ removeIndex, sequelize: { query: present } });

    expect(addIndex).toHaveBeenCalledWith(
      table,
      columns,
      expect.objectContaining({ name: "whatsapp_chat_states_public_cursor" })
    );
    expect(removeIndex).toHaveBeenCalledWith(
      table,
      "whatsapp_chat_states_public_cursor"
    );
  });

  it("is a no-op when the index already exists (publish drift)", async () => {
    const addIndex = jest.fn();
    const removeIndex = jest.fn();
    const present = jest.fn().mockResolvedValue([{ found: 1 }]);
    const missing = jest.fn().mockResolvedValue([]);

    await migration.up({ addIndex, sequelize: { query: present } });
    await migration.down({ removeIndex, sequelize: { query: missing } });

    expect(addIndex).not.toHaveBeenCalled();
    expect(removeIndex).not.toHaveBeenCalled();
  });
});
