const migration = require("../20260730000001-create-message-templates");
export {};
describe("message templates migration", () => {
  it("creates the isolated messaging table and reverses it", async () => {
    const createTable = jest.fn(); const addIndex = jest.fn(); const dropTable = jest.fn();
    await migration.up({ createTable, addIndex }); await migration.down({ dropTable });
    expect(createTable).toHaveBeenCalledWith({ tableName: "MessageTemplates", schema: "messaging" }, expect.objectContaining({ companyId: expect.any(Object), publicId: expect.any(Object), content: expect.any(Object), variables: expect.any(Object) }));
    expect(addIndex).toHaveBeenCalledWith({ tableName: "MessageTemplates", schema: "messaging" }, ["companyId", "publicId"], expect.objectContaining({ unique: true }));
    expect(dropTable).toHaveBeenCalledWith({ tableName: "MessageTemplates", schema: "messaging" });
  });
});
