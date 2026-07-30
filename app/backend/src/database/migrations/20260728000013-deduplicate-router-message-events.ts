import { QueryInterface } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    // DELETE + CREATE INDEX na mesma transação: evita janela em que duplicatas
    // novas passariam entre os dois passos em ambiente com escrita ativa.
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.sequelize.query(`
      WITH ranked AS (
        SELECT
          "id",
          ROW_NUMBER() OVER (
            PARTITION BY "companyId", "eventType", "aggregateId"
            ORDER BY
              CASE "status"
                WHEN 'completed' THEN 0
                WHEN 'processing' THEN 1
                WHEN 'ready' THEN 2
                ELSE 3
              END,
              "createdAt" ASC,
              "id" ASC
          ) AS duplicate_rank
        FROM messaging."MessagingOutboxEvents"
        WHERE "eventType" IN (
          'message.received',
          'button.clicked',
          'conversation.created'
        )
      )
      DELETE FROM messaging."MessagingOutboxEvents" AS event
      USING ranked
      WHERE event."id" = ranked."id"
        AND ranked.duplicate_rank > 1
    `, { transaction });
      await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS messaging_router_message_event_unique
      ON messaging."MessagingOutboxEvents" ("companyId", "eventType", "aggregateId")
      WHERE "eventType" IN (
        'message.received',
        'button.clicked',
        'conversation.created'
      )
    `, { transaction });
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS messaging.messaging_router_message_event_unique
    `);
  }
};
