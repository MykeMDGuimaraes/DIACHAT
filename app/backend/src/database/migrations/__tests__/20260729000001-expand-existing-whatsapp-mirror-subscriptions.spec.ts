const migration = require("../20260729000001-expand-existing-whatsapp-mirror-subscriptions");

export {};

describe("existing WhatsApp mirror subscription expansion", () => {
  it("normalizes legacy and partially expanded JSONB event lists", async () => {
    const query = jest.fn().mockResolvedValue([
      {
        id: "legacy",
        events: ["message.received", "message.status.updated"]
      },
      {
        id: "partial",
        events: [
          "message.received",
          "message.reaction",
          "message.reaction"
        ]
      }
    ]);
    const bulkUpdate = jest.fn();

    await migration.up({
      sequelize: { query },
      bulkUpdate
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        "\"events\" @> '[\"message.received\"]'::jsonb"
      ),
      expect.any(Object)
    );
    expect(bulkUpdate).toHaveBeenCalledWith(
      { tableName: "WebhookSubscriptions", schema: "messaging" },
      {
        events: [
          "message.received",
          "message.status.updated",
          "message.reaction",
          "message.edited",
          "message.deleted",
          "chat.updated",
          "connection.updated"
        ],
        updatedAt: expect.any(Date)
      },
      { id: "legacy" }
    );
    expect(bulkUpdate).toHaveBeenCalledWith(
      { tableName: "WebhookSubscriptions", schema: "messaging" },
      {
        events: [
          "message.received",
          "message.reaction",
          "message.edited",
          "message.deleted",
          "chat.updated",
          "connection.updated"
        ],
        updatedAt: expect.any(Date)
      },
      { id: "partial" }
    );
  });

  it("does not try to reverse a subscription data normalization", async () => {
    await expect(migration.down()).resolves.toBeUndefined();
  });
});
