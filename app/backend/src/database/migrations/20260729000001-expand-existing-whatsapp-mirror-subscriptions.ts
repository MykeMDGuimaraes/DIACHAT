import { QueryInterface, QueryTypes } from "sequelize";

const subscriptions = {
  tableName: "WebhookSubscriptions",
  schema: "messaging"
};

const receivedMirrorEvents = [
  "message.received",
  "message.reaction",
  "message.edited",
  "message.deleted",
  "chat.updated",
  "connection.updated"
];

interface SubscriptionRow {
  id: string;
  events: unknown;
}

const normalizeEvents = (value: unknown): string[] => {
  const existing = Array.isArray(value)
    ? value.filter((event): event is string => typeof event === "string")
    : [];
  return [...new Set([...existing, ...receivedMirrorEvents])];
};

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const rows = (await queryInterface.sequelize.query(
      `
        SELECT "id", "events"
        FROM "messaging"."WebhookSubscriptions"
        WHERE "events" @> '["message.received"]'::jsonb
      `,
      { type: QueryTypes.SELECT }
    )) as SubscriptionRow[];
    const updatedAt = new Date();

    await Promise.all(
      rows.map(async row => {
        const events = normalizeEvents(row.events);
        const unchanged =
          Array.isArray(row.events) &&
          row.events.length === events.length &&
          row.events.every((event, index) => event === events[index]);
        if (unchanged) return;
        await queryInterface.bulkUpdate(
          subscriptions,
          { events, updatedAt },
          { id: row.id }
        );
      })
    );
  },

  // Existing intent cannot be inferred after expansion, so this data
  // normalization is intentionally not reversed.
  down: async (): Promise<void> => undefined
};
