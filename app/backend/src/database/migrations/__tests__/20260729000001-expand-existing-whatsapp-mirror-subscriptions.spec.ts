const migration = require("../20260729000001-expand-existing-whatsapp-mirror-subscriptions");

export {};

const backupTable = {
  tableName: "WebhookSubscriptionMirrorEventBackups",
  schema: "messaging"
};

const createHarness = (seed: Record<string, string[]>) => {
  const subscriptions = new Map(
    Object.entries(seed).map(([id, events]) => [id, [...events]])
  );
  const backups = new Map<string, string[]>();
  const operations: string[] = [];
  let readingBackups = false;
  const transactionValue = { id: "migration-transaction" };
  const transaction = jest.fn(async callback => {
    operations.push("transaction:start");
    const result = await callback(transactionValue);
    operations.push("transaction:commit");
    return result;
  });
  const query = jest.fn(async (sql: string, options: any = {}) => {
    if (sql.includes("CREATE TABLE IF NOT EXISTS")) {
      operations.push("backup:create");
      return [];
    }
    if (sql.includes("INSERT INTO")) {
      const { subscriptionId, originalEvents } = options.replacements;
      if (!backups.has(subscriptionId)) {
        backups.set(subscriptionId, JSON.parse(originalEvents));
      }
      operations.push(`backup:insert:${subscriptionId}`);
      return [];
    }
    if (sql.includes("WebhookSubscriptionMirrorEventBackups")) {
      readingBackups = true;
      operations.push("backup:read");
      return [...backups].map(([subscriptionId, originalEvents]) => ({
        subscriptionId,
        originalEvents: [...originalEvents]
      }));
    }
    return [...subscriptions]
      .filter(([, events]) => events.includes("message.received"))
      .map(([id, events]) => ({ id, events: [...events] }));
  });
  const bulkUpdate = jest.fn(
    async (_table, values: { events: string[] }, where: { id: string }) => {
      subscriptions.set(where.id, [...values.events]);
      operations.push(
        `${readingBackups ? "restore" : "expand"}:${where.id}`
      );
    }
  );
  const dropTable = jest.fn(async table => {
    operations.push("backup:drop");
    expect(table).toEqual(backupTable);
  });

  return {
    queryInterface: {
      sequelize: { query, transaction },
      bulkUpdate,
      dropTable
    },
    subscriptions,
    backups,
    operations,
    transaction,
    transactionValue,
    dropTable
  };
};

describe("existing WhatsApp mirror subscription expansion", () => {
  it("backs up exact arrays before normalizing only subscriptions that change", async () => {
    const harness = createHarness({
      legacy: ["message.received", "message.status.updated"],
      preselected: ["message.received", "message.reaction"],
      complete: [
        "message.received",
        "message.reaction",
        "message.edited",
        "message.deleted",
        "chat.updated",
        "connection.updated"
      ]
    });

    await migration.up(harness.queryInterface);

    expect(harness.backups).toEqual(
      new Map([
        ["legacy", ["message.received", "message.status.updated"]],
        ["preselected", ["message.received", "message.reaction"]]
      ])
    );
    expect(harness.subscriptions.get("preselected")).toEqual([
      "message.received",
      "message.reaction",
      "message.edited",
      "message.deleted",
      "chat.updated",
      "connection.updated"
    ]);
    expect(harness.operations.indexOf("backup:insert:legacy")).toBeLessThan(
      harness.operations.indexOf("expand:legacy")
    );
    expect(harness.operations).not.toContain("backup:insert:complete");
  });

  it("restores exact pre-up arrays before dropping the backup in a transaction", async () => {
    const original = {
      legacy: ["message.received", "message.status.updated"],
      preselected: ["message.received", "message.reaction"]
    };
    const harness = createHarness(original);
    await migration.up(harness.queryInterface);
    harness.operations.length = 0;

    await migration.down(harness.queryInterface);

    expect(Object.fromEntries(harness.subscriptions)).toEqual(original);
    expect(harness.operations).toEqual([
      "transaction:start",
      "backup:read",
      "restore:legacy",
      "restore:preselected",
      "backup:drop",
      "transaction:commit"
    ]);
    expect(harness.dropTable).toHaveBeenCalledWith(backupTable, {
      transaction: harness.transactionValue
    });
  });
});
