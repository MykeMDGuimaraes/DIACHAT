const migration = require("../20260724000001-create-api-credentials");

export {};

describe("create api credentials migration", () => {
  it("creates tenant-scoped credentials with a unique token identifier", async () => {
    const createTable = jest.fn();
    const addIndex = jest.fn();

    await migration.up({ createTable, addIndex });

    expect(createTable).toHaveBeenCalledWith(
      { tableName: "ApiCredentials", schema: "messaging" },
      expect.objectContaining({ tokenId: expect.any(Object), secretHash: expect.any(Object) })
    );
    expect(addIndex).toHaveBeenCalledWith(
      { tableName: "ApiCredentials", schema: "messaging" },
      ["tokenId"],
      expect.objectContaining({ unique: true })
    );
  });
});
