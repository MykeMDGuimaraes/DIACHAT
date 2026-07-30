import { QueryInterface, QueryTypes } from "sequelize";

const backups = {
  tableName: "WebhookSubscriptionMirrorEventBackups",
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

interface BackupRow {
  subscriptionId: string;
  originalEvents: string[];
}

const normalizeEvents = (value: unknown): string[] => {
  const existing = Array.isArray(value)
    ? value.filter((event): event is string => typeof event === "string")
    : [];
  return [...new Set([...existing, ...receivedMirrorEvents])];
};

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.sequelize.query(
        `
          CREATE TABLE IF NOT EXISTS
            "messaging"."WebhookSubscriptionMirrorEventBackups" (
              "subscriptionId" UUID PRIMARY KEY
                REFERENCES "messaging"."WebhookSubscriptions" ("id")
                ON UPDATE CASCADE ON DELETE CASCADE,
              "originalEvents" JSONB NOT NULL
            )
        `,
        { transaction }
      );
      const rows = (await queryInterface.sequelize.query(
        `
          SELECT "id", "events"
          FROM "messaging"."WebhookSubscriptions"
          WHERE "events" @> '["message.received"]'::jsonb
        `,
        { type: QueryTypes.SELECT, transaction }
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
          await queryInterface.sequelize.query(
            `
              INSERT INTO
                "messaging"."WebhookSubscriptionMirrorEventBackups"
                ("subscriptionId", "originalEvents")
              VALUES (:subscriptionId, CAST(:originalEvents AS JSONB))
              ON CONFLICT ("subscriptionId") DO NOTHING
            `,
            {
              replacements: {
                subscriptionId: row.id,
                originalEvents: JSON.stringify(row.events)
              },
              transaction
            }
          );
          // bulkUpdate serializa arrays JS como literal ARRAY do Postgres
          // ("{a,b}"), que uma coluna JSONB rejeita ("Expected ':'") — por
          // isso o UPDATE usa SQL parametrizado com CAST explícito.
          await queryInterface.sequelize.query(
            `
              UPDATE "messaging"."WebhookSubscriptions"
              SET "events" = CAST(:events AS JSONB),
                  "updatedAt" = :updatedAt
              WHERE "id" = :id
            `,
            {
              replacements: {
                events: JSON.stringify(events),
                updatedAt,
                id: row.id
              },
              transaction
            }
          );
        })
      );
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async transaction => {
      const backupTable = (await queryInterface.sequelize.query(
        `SELECT to_regclass('messaging."WebhookSubscriptionMirrorEventBackups"') AS "regclass"`,
        { type: QueryTypes.SELECT, transaction }
      )) as Array<{ regclass: string | null }>;
      if (!backupTable.length || !backupTable[0].regclass) return;
      const rows = (await queryInterface.sequelize.query(
        `
          SELECT "subscriptionId", "originalEvents"
          FROM "messaging"."WebhookSubscriptionMirrorEventBackups"
        `,
        { type: QueryTypes.SELECT, transaction }
      )) as BackupRow[];
      const updatedAt = new Date();
      await Promise.all(
        rows.map(row =>
          queryInterface.sequelize.query(
            `
              UPDATE "messaging"."WebhookSubscriptions"
              SET "events" = CAST(:events AS JSONB),
                  "updatedAt" = :updatedAt
              WHERE "id" = :id
            `,
            {
              replacements: {
                events: JSON.stringify(row.originalEvents),
                updatedAt,
                id: row.subscriptionId
              },
              transaction
            }
          )
        )
      );
      await queryInterface.dropTable(backups, { transaction });
    });
  }
};
