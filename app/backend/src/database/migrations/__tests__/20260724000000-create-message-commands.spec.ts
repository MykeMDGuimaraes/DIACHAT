const migration = require("../20260724000000-create-message-commands");

export {};

describe("create message commands migration", () => {
  it("creates the messaging schema and a unique idempotency index", async () => {
    const query = jest.fn();
    const createTable = jest.fn();
    const addIndex = jest.fn();

    await migration.up({
      sequelize: { query },
      createTable,
      addIndex
    });

    expect(query).toHaveBeenCalledWith("CREATE SCHEMA IF NOT EXISTS messaging;");
    expect(createTable).toHaveBeenCalledWith(
      { tableName: "MessageCommands", schema: "messaging" },
      expect.objectContaining({ id: expect.any(Object), status: expect.any(Object) })
    );
    expect(addIndex).toHaveBeenCalledWith(
      { tableName: "MessageCommands", schema: "messaging" },
      ["companyId", "idempotencyScope", "idempotencyKey"],
      expect.objectContaining({ unique: true })
    );
  });
});
