const migration = require("../20260730000000-add-public-conversation-pagination-index");
export {};
describe("public conversation pagination migration", () => {
  it("adds and removes only the cursor index", async () => {
    const addIndex = jest.fn(); const removeIndex = jest.fn();
    await migration.up({ addIndex });
    await migration.down({ removeIndex });
    expect(addIndex).toHaveBeenCalledWith({ tableName: "WhatsAppChatStates", schema: "messaging" }, ["companyId", "whatsappId", "lastMessageAt", "id"], expect.objectContaining({ name: "whatsapp_chat_states_public_cursor" }));
    expect(removeIndex).toHaveBeenCalledWith({ tableName: "WhatsAppChatStates", schema: "messaging" }, "whatsapp_chat_states_public_cursor");
  });
});
