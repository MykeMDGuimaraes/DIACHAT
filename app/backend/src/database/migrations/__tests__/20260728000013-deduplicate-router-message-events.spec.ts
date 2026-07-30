const migration = require("../20260728000013-deduplicate-router-message-events");

export {};

describe("20260728000013-deduplicate-router-message-events", () => {
  it("creates and removes the partial exactly-once event index", async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const transaction = { id: "tx-under-test" };
    const queryInterface = {
      sequelize: {
        query,
        transaction: jest.fn(async (callback: (tx: unknown) => Promise<void>) =>
          callback(transaction)
        )
      }
    } as any;

    await migration.up(queryInterface);
    expect(query.mock.calls[0][0]).toContain(
      "ROW_NUMBER() OVER"
    );
    expect(query.mock.calls[0][0]).toContain(
      "ranked.duplicate_rank > 1"
    );
    // DELETE e CREATE INDEX rodam na mesma transação (sem janela para
    // duplicatas novas entre os dois passos).
    expect(query.mock.calls[0][1]).toEqual({ transaction });
    expect(query.mock.calls[1][0]).toContain(
      "messaging_router_message_event_unique"
    );
    expect(query.mock.calls[1][0]).toContain(
      '"companyId", "eventType", "aggregateId"'
    );
    expect(query.mock.calls[1][0]).toContain("'message.received'");
    expect(query.mock.calls[1][0]).toContain("'button.clicked'");
    expect(query.mock.calls[1][0]).toContain("'conversation.created'");
    expect(query.mock.calls[1][1]).toEqual({ transaction });

    await migration.down(queryInterface);
    expect(query.mock.calls[2][0]).toContain(
      "DROP INDEX IF EXISTS messaging.messaging_router_message_event_unique"
    );
  });
});
