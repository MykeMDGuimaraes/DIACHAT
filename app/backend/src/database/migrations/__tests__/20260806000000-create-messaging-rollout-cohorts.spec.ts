const migration = require("../20260806000000-create-messaging-rollout-cohorts");

export {};

const table = { tableName: "MessagingRolloutCohorts", schema: "messaging" };

describe("messaging rollout cohorts migration", () => {
  it("creates the cohort table with unique index and reverses it", async () => {
    const createTable = jest.fn();
    const addIndex = jest.fn();
    const dropTable = jest.fn();
    const nothingExists = jest.fn(async () => [{ regclass: null }]);

    await migration.up({
      createTable,
      addIndex,
      sequelize: { query: nothingExists }
    });
    await migration.down({
      dropTable,
      sequelize: { query: jest.fn(async () => [{ regclass: "x" }]) }
    });

    expect(createTable).toHaveBeenCalledWith(
      table,
      expect.objectContaining({
        capability: expect.objectContaining({ allowNull: false }),
        companyId: expect.objectContaining({ allowNull: false }),
        mode: expect.objectContaining({ allowNull: false })
      })
    );
    expect(addIndex).toHaveBeenCalledWith(
      table,
      expect.objectContaining({
        unique: true,
        fields: ["capability", "companyId"]
      })
    );
    expect(dropTable).toHaveBeenCalledWith(table);
  });

  it("is a no-op when table and index already exist (publish drift)", async () => {
    const createTable = jest.fn();
    const addColumn = jest.fn();
    const addIndex = jest.fn();
    const allColumns = {
      id: {},
      capability: {},
      companyId: {},
      mode: {},
      createdAt: {},
      updatedAt: {}
    };
    const everythingExists = jest.fn(async () => [{ regclass: "x" }]);

    await migration.up({
      createTable,
      addColumn,
      addIndex,
      describeTable: jest.fn().mockResolvedValue(allColumns),
      sequelize: { query: everythingExists }
    });

    expect(createTable).not.toHaveBeenCalled();
    expect(addColumn).not.toHaveBeenCalled();
    expect(addIndex).not.toHaveBeenCalled();
  });

  it("repairs missing columns when the table already exists (partial drift)", async () => {
    const addColumn = jest.fn();
    const exists = jest.fn(async () => [{ regclass: "x" }]);

    await migration.up({
      addColumn,
      createTable: jest.fn(),
      addIndex: jest.fn(),
      describeTable: jest.fn().mockResolvedValue({ id: {} }),
      sequelize: { query: exists }
    });

    expect(addColumn).toHaveBeenCalledWith(
      table,
      "capability",
      expect.any(Object)
    );
    expect(addColumn).toHaveBeenCalledWith(
      table,
      "companyId",
      expect.any(Object)
    );
    expect(addColumn).toHaveBeenCalledWith(table, "mode", expect.any(Object));
  });
});
