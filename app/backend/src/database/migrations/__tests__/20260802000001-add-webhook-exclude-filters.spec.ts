const migration = require("../20260802000001-add-webhook-exclude-filters");

export {};

const table = { tableName: "WebhookSubscriptions", schema: "messaging" };

describe("webhook exclusion filters migration", () => {
  it("adds an empty JSON filter collection and reverses it", async () => {
    const addColumn = jest.fn();
    const removeColumn = jest.fn();

    await migration.up({
      describeTable: jest.fn().mockResolvedValue({}),
      addColumn
    });
    await migration.down({
      describeTable: jest.fn().mockResolvedValue({ excludeFilters: {} }),
      removeColumn
    });

    expect(addColumn).toHaveBeenCalledWith(
      table,
      "excludeFilters",
      expect.objectContaining({ allowNull: false, defaultValue: [] })
    );
    expect(removeColumn).toHaveBeenCalledWith(table, "excludeFilters");
  });

  it("is idempotent when the target state already exists", async () => {
    const addColumn = jest.fn();
    const removeColumn = jest.fn();

    await migration.up({
      describeTable: jest.fn().mockResolvedValue({ excludeFilters: {} }),
      addColumn
    });
    await migration.down({
      describeTable: jest.fn().mockResolvedValue({}),
      removeColumn
    });

    expect(addColumn).not.toHaveBeenCalled();
    expect(removeColumn).not.toHaveBeenCalled();
  });
});
