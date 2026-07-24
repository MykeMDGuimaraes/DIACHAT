const migration = require("../20260724000002-create-messaging-outbox-events");

export {};

describe("create messaging outbox events migration", () => {
  it("creates a dispatch index for ready events", async () => {
    const createTable = jest.fn();
    const addIndex = jest.fn();

    await migration.up({ createTable, addIndex });

    expect(createTable).toHaveBeenCalledWith(
      { tableName: "MessagingOutboxEvents", schema: "messaging" },
      expect.objectContaining({ eventType: expect.any(Object), status: expect.any(Object) })
    );
    expect(addIndex).toHaveBeenCalledWith(
      { tableName: "MessagingOutboxEvents", schema: "messaging" },
      ["status", "availableAt", "leaseExpiresAt"],
      expect.any(Object)
    );
  });
});
