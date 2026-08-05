const migration = require("../20260805000001-create-whatsapp-session-keys");

export {};

const TABLE = { tableName: "WhatsAppSessionKeys", schema: "messaging" };

const COLUMNS = [
  "whatsappId",
  "keyType",
  "keyId",
  "ciphertext",
  "revision",
  "generation",
  "createdAt",
  "updatedAt"
];

const queryInterface = (options: {
  exists: boolean;
  existingColumns?: string[];
}) => ({
  sequelize: {
    query: jest
      .fn()
      .mockResolvedValue([{ regclass: options.exists ? "x" : null }])
  },
  createTable: jest.fn().mockResolvedValue(undefined),
  describeTable: jest
    .fn()
    .mockResolvedValue(
      Object.fromEntries((options.existingColumns ?? []).map(c => [c, {}]))
    ),
  addColumn: jest.fn().mockResolvedValue(undefined),
  dropTable: jest.fn().mockResolvedValue(undefined)
});

describe("create WhatsAppSessionKeys migration", () => {
  it("creates the table with composite PK and fencing columns when absent", async () => {
    const qi = queryInterface({ exists: false });

    await migration.up(qi);

    expect(qi.createTable).toHaveBeenCalledTimes(1);
    const [table, columns] = qi.createTable.mock.calls[0];
    expect(table).toEqual(TABLE);
    for (const column of COLUMNS) {
      expect(columns[column]).toBeDefined();
    }
    // PK composta (whatsappId, keyType, keyId): escrita/leitura por id.
    expect(columns.whatsappId.primaryKey).toBe(true);
    expect(columns.keyType.primaryKey).toBe(true);
    expect(columns.keyId.primaryKey).toBe(true);
    // Payload nunca em claro + fencing revisao/geracao.
    expect(columns.ciphertext.allowNull).toBe(false);
    expect(columns.revision.allowNull).toBe(false);
    expect(columns.generation.allowNull).toBe(false);
  });

  it("is idempotent: existing complete table is left untouched", async () => {
    const qi = queryInterface({ exists: true, existingColumns: COLUMNS });

    await migration.up(qi);

    expect(qi.createTable).not.toHaveBeenCalled();
    expect(qi.addColumn).not.toHaveBeenCalled();
  });

  it("repairs partial drift by adding only the missing columns", async () => {
    const qi = queryInterface({
      exists: true,
      existingColumns: ["whatsappId", "keyType", "keyId"]
    });

    await migration.up(qi);

    expect(qi.createTable).not.toHaveBeenCalled();
    expect(qi.addColumn).toHaveBeenCalledTimes(COLUMNS.length - 3);
    expect(qi.addColumn).toHaveBeenCalledWith(
      TABLE,
      "ciphertext",
      expect.any(Object)
    );
    expect(qi.addColumn).toHaveBeenCalledWith(
      TABLE,
      "generation",
      expect.any(Object)
    );
  });

  it("rollback drops the table and a reapply recreates it", async () => {
    const qi = queryInterface({ exists: true, existingColumns: COLUMNS });

    await migration.down(qi);
    expect(qi.dropTable).toHaveBeenCalledWith(TABLE);

    const qiReapply = queryInterface({ exists: false });
    await migration.up(qiReapply);
    expect(qiReapply.createTable).toHaveBeenCalledTimes(1);
  });

  it("rollback is a no-op when the table does not exist", async () => {
    const qi = queryInterface({ exists: false });

    await migration.down(qi);

    expect(qi.dropTable).not.toHaveBeenCalled();
  });
});
