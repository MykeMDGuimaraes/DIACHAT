import { DataTypes, QueryInterface, QueryTypes } from "sequelize";

const lidIndex = "contacts_company_whatsapp_lid_unique";

const columnExists = async (
  queryInterface: QueryInterface,
  column: string
): Promise<boolean> => {
  const columns = await queryInterface.describeTable("Contacts");
  return Boolean(columns[column]);
};

const indexExists = async (
  queryInterface: QueryInterface,
  indexName: string
): Promise<boolean> => {
  const rows = await queryInterface.sequelize.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = :indexName`,
    { replacements: { indexName }, type: QueryTypes.SELECT }
  );
  return rows.length > 0;
};

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.changeColumn("Contacts", "number", {
      type: DataTypes.STRING,
      allowNull: true
    });

    if (!(await columnExists(queryInterface, "jidServer"))) {
      await queryInterface.addColumn("Contacts", "jidServer", {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: "phone"
      });
    }
    if (!(await columnExists(queryInterface, "lid"))) {
      await queryInterface.addColumn("Contacts", "lid", {
        type: DataTypes.STRING,
        allowNull: true
      });
    }
    await queryInterface.sequelize.query(
      `ALTER TABLE "Contacts" DROP CONSTRAINT IF EXISTS "contacts_jid_server_check";
       ALTER TABLE "Contacts" ADD CONSTRAINT "contacts_jid_server_check"
       CHECK ("jidServer" IN ('phone', 'lid', 'group'));`
    );
    if (!(await indexExists(queryInterface, lidIndex))) {
      await queryInterface.sequelize.query(
        `CREATE UNIQUE INDEX "${lidIndex}" ON "Contacts" ("companyId", "whatsappId", "lid")
         WHERE "lid" IS NOT NULL AND "whatsappId" IS NOT NULL`
      );
    }
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    if (await indexExists(queryInterface, lidIndex)) {
      await queryInterface.removeIndex("Contacts", lidIndex);
    }
    await queryInterface.sequelize.query(
      `ALTER TABLE "Contacts" DROP CONSTRAINT IF EXISTS "contacts_jid_server_check"`
    );
    if (await columnExists(queryInterface, "lid")) {
      await queryInterface.removeColumn("Contacts", "lid");
    }
    if (await columnExists(queryInterface, "jidServer")) {
      await queryInterface.removeColumn("Contacts", "jidServer");
    }
    // A rollback cannot safely restore NOT NULL while LID-only contacts exist.
    // Keep number nullable; application rollback remains compatible with rows
    // that still have a real phone number.
  }
};
