const migration = require("../20260804000000-create-whatsapp-session-leases");

export {};

const table = { tableName: "WhatsAppSessionLeases", schema: "messaging" };

describe("whatsapp session leases migration", () => {
  it("creates the lease table and reverses it", async () => {
    const createTable = jest.fn();
    const dropTable = jest.fn();
    // up(): nada existe -> cria. down(): tudo existe -> remove.
    const nothingExists = jest.fn(async () => [{ regclass: null }]);
    const everythingExists = jest.fn(async () => [
      { regclass: "messaging.WhatsAppSessionLeases" }
    ]);

    await migration.up({
      createTable,
      sequelize: { query: nothingExists }
    });
    await migration.down({
      dropTable,
      sequelize: { query: everythingExists }
    });

    expect(createTable).toHaveBeenCalledWith(
      table,
      expect.objectContaining({
        whatsappId: expect.objectContaining({ primaryKey: true }),
        ownerId: expect.any(Object),
        fencingToken: expect.any(Object),
        expiresAt: expect.any(Object),
        heartbeatAt: expect.any(Object)
      })
    );
    expect(dropTable).toHaveBeenCalledWith(table);
  });

  it("repairs missing columns when the table already exists (partial drift)", async () => {
    const addColumn = jest.fn();
    const createTable = jest.fn();
    const exists = jest.fn(async () => [
      { regclass: "messaging.WhatsAppSessionLeases" }
    ]);

    await migration.up({
      addColumn,
      createTable,
      describeTable: jest.fn().mockResolvedValue({ whatsappId: {} }),
      sequelize: { query: exists }
    });

    expect(createTable).not.toHaveBeenCalled();
    expect(addColumn).toHaveBeenCalledWith(
      table,
      "fencingToken",
      expect.any(Object)
    );
    expect(addColumn).toHaveBeenCalledWith(
      table,
      "expiresAt",
      expect.any(Object)
    );
  });

  it("is a no-op when the table is already complete (publish drift)", async () => {
    const createTable = jest.fn();
    const addColumn = jest.fn();
    const dropTable = jest.fn();
    const allColumns = {
      whatsappId: {},
      ownerId: {},
      fencingToken: {},
      expiresAt: {},
      heartbeatAt: {},
      createdAt: {},
      updatedAt: {}
    };
    const exists = jest.fn(async () => [
      { regclass: "messaging.WhatsAppSessionLeases" }
    ]);

    await migration.up({
      createTable,
      addColumn,
      describeTable: jest.fn().mockResolvedValue(allColumns),
      sequelize: { query: exists }
    });
    await migration.down({
      dropTable,
      sequelize: { query: jest.fn(async () => [{ regclass: null }]) }
    });

    expect(createTable).not.toHaveBeenCalled();
    expect(addColumn).not.toHaveBeenCalled();
    expect(dropTable).not.toHaveBeenCalled();
  });
});
