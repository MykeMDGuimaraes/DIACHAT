const migration = require("../20260805000000-add-delivery-health-to-whatsapps");

export {};

const HEALTH_COLUMNS = [
  "deliveryHealth",
  "deliveryHealthChangedAt",
  "lastConfirmedDeliveryAt",
  "consecutiveUnconfirmedDeliveries",
  "lastDeliveryErrorCode",
  "lastUnconfirmedDeliveryAt"
];

const queryInterface = (existingColumns: string[] = []) => ({
  describeTable: jest
    .fn()
    .mockResolvedValue(
      Object.fromEntries(existingColumns.map(column => [column, {}]))
    ),
  addColumn: jest.fn().mockResolvedValue(undefined),
  removeColumn: jest.fn().mockResolvedValue(undefined)
});

describe("add delivery health to Whatsapps migration", () => {
  it("applies all health columns on a table without them", async () => {
    const qi = queryInterface();

    await migration.up(qi);

    expect(qi.addColumn).toHaveBeenCalledTimes(HEALTH_COLUMNS.length);
    for (const column of HEALTH_COLUMNS) {
      expect(qi.addColumn).toHaveBeenCalledWith(
        { tableName: "Whatsapps", schema: "public" },
        column,
        expect.any(Object)
      );
    }
  });

  it("is idempotent: reapplying adds nothing when columns already exist", async () => {
    const qi = queryInterface(HEALTH_COLUMNS);

    await migration.up(qi);
    await migration.up(qi);

    expect(qi.addColumn).not.toHaveBeenCalled();
  });

  it("repairs partial drift: only missing columns are added", async () => {
    const qi = queryInterface([
      "deliveryHealth",
      "consecutiveUnconfirmedDeliveries"
    ]);

    await migration.up(qi);

    expect(qi.addColumn).toHaveBeenCalledTimes(HEALTH_COLUMNS.length - 2);
    expect(qi.addColumn).not.toHaveBeenCalledWith(
      expect.anything(),
      "deliveryHealth",
      expect.anything()
    );
  });

  it("rolls back only the columns that exist and can be applied again", async () => {
    const qi = queryInterface(HEALTH_COLUMNS);

    await migration.down(qi);

    expect(qi.removeColumn).toHaveBeenCalledTimes(HEALTH_COLUMNS.length);

    const reapply = queryInterface();
    await migration.up(reapply);
    expect(reapply.addColumn).toHaveBeenCalledTimes(HEALTH_COLUMNS.length);
  });
});
