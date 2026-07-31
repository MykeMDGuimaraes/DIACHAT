const migration = require("../20260730000001-create-message-templates");

export {};

const table = { tableName: "MessageTemplates", schema: "messaging" };

describe("message templates migration", () => {
  it("creates the isolated messaging table and reverses it", async () => {
    const createTable = jest.fn();
    const addIndex = jest.fn();
    const dropTable = jest.fn();
    // up(): nada existe -> cria tudo. down(): tudo existe -> remove tudo.
    const nothingExists = jest.fn(async (sql: string) =>
      sql.includes("to_regclass") ? [{ regclass: null }] : []
    );
    const everythingExists = jest.fn(async (sql: string) =>
      sql.includes("to_regclass") ? [{ regclass: "messaging.MessageTemplates" }] : [{ found: 1 }]
    );

    await migration.up({
      createTable,
      addIndex,
      sequelize: { query: nothingExists }
    });
    await migration.down({
      dropTable,
      removeIndex: jest.fn(),
      sequelize: { query: everythingExists }
    });

    expect(createTable).toHaveBeenCalledWith(
      table,
      expect.objectContaining({
        companyId: expect.any(Object),
        publicId: expect.any(Object),
        content: expect.any(Object),
        variables: expect.any(Object)
      })
    );
    expect(addIndex).toHaveBeenCalledWith(
      table,
      ["companyId", "publicId"],
      expect.objectContaining({ unique: true })
    );
    expect(dropTable).toHaveBeenCalledWith(table);
  });

  it("repairs missing columns when the table already exists (partial drift)", async () => {
    const addColumn = jest.fn();
    const createTable = jest.fn();
    const addIndex = jest.fn();
    // Tabela existe mas vazia de colunas; indice ausente.
    const query = jest.fn(async (sql: string) =>
      sql.includes("to_regclass")
        ? [{ regclass: "messaging.MessageTemplates" }]
        : []
    );

    await migration.up({
      addColumn,
      createTable,
      addIndex,
      describeTable: jest.fn().mockResolvedValue({}),
      sequelize: { query }
    });

    expect(createTable).not.toHaveBeenCalled();
    expect(addColumn).toHaveBeenCalledWith(table, "content", expect.any(Object));
    expect(addColumn).toHaveBeenCalledWith(table, "variables", expect.any(Object));
    expect(addIndex).toHaveBeenCalledWith(
      table,
      ["companyId", "publicId"],
      expect.objectContaining({ unique: true })
    );
  });

  it("is a no-op when table and index already exist (publish drift)", async () => {
    const createTable = jest.fn();
    const addIndex = jest.fn();
    const dropTable = jest.fn();
    const allColumns = {
      id: {},
      companyId: {},
      publicId: {},
      name: {},
      content: {},
      variables: {},
      version: {},
      active: {},
      createdBy: {},
      createdAt: {},
      updatedAt: {}
    };
    const everythingExists = jest.fn(async (sql: string) =>
      sql.includes("to_regclass") ? [{ regclass: "messaging.MessageTemplates" }] : [{ found: 1 }]
    );

    await migration.up({
      createTable,
      addIndex,
      describeTable: jest.fn().mockResolvedValue(allColumns),
      sequelize: { query: everythingExists }
    });
    await migration.down({
      dropTable,
      sequelize: { query: jest.fn().mockResolvedValue([]) }
    });

    expect(createTable).not.toHaveBeenCalled();
    expect(addIndex).not.toHaveBeenCalled();
    expect(dropTable).not.toHaveBeenCalled();
  });
});
