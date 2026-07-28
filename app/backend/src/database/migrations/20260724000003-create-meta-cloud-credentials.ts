import { DataTypes, QueryInterface } from "sequelize";

const table = { tableName: "MetaCloudCredentials", schema: "messaging" };

const tableExists = async (
  queryInterface: QueryInterface,
  regclass: string
): Promise<boolean> => {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT to_regclass('${regclass}') AS tbl`
  );
  const first = (rows as Array<{ tbl: string | null }>)[0];
  return Boolean(first && first.tbl);
};

const existingIndexNames = async (
  queryInterface: QueryInterface
): Promise<Set<string>> => {
  const [rows] = await queryInterface.sequelize.query(
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'messaging' AND tablename = 'MetaCloudCredentials'"
  );
  return new Set(
    (rows as Array<{ indexname: string }>).map(row => row.indexname)
  );
};

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    // Idempotente: a sincronização de schema do publish (dev→prod) pode já ter
    // adicionado colunas em tabelas existentes sem registrar esta migração.
    const whatsapps = await queryInterface.describeTable("Whatsapps");
    if (!whatsapps.channelType) {
      await queryInterface.addColumn("Whatsapps", "channelType", {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "baileys"
      });
    }
    if (!whatsapps.baileysMode) {
      await queryInterface.addColumn("Whatsapps", "baileysMode", {
        type: DataTypes.STRING,
        allowNull: true
      });
    }
    await queryInterface.sequelize.query(
      'UPDATE "Whatsapps" SET "baileysMode" = COALESCE("provider", \'beta\') WHERE "baileysMode" IS NULL'
    );

    if (!(await tableExists(queryInterface, 'messaging."MetaCloudCredentials"'))) {
      await queryInterface.createTable(table, {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      companyId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: { tableName: "Companies", schema: "public" },
          key: "id"
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      whatsappId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: { tableName: "Whatsapps", schema: "public" },
          key: "id"
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      publicId: { type: DataTypes.UUID, allowNull: false },
      appId: { type: DataTypes.STRING, allowNull: false },
      wabaId: { type: DataTypes.STRING, allowNull: false },
      phoneNumberId: { type: DataTypes.STRING, allowNull: false },
      accessTokenCiphertext: { type: DataTypes.TEXT, allowNull: false },
      appSecretCiphertext: { type: DataTypes.TEXT, allowNull: false },
      verifyTokenHash: { type: DataTypes.STRING, allowNull: false },
      keyVersion: { type: DataTypes.STRING, allowNull: false },
      validationStatus: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "PENDING_WEBHOOK"
      },
      webhookVerifiedAt: { type: DataTypes.DATE, allowNull: true },
      lastValidatedAt: { type: DataTypes.DATE, allowNull: true },
      lastError: { type: DataTypes.TEXT, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
      });
    }
    const indexes = await existingIndexNames(queryInterface);
    if (!indexes.has("meta_cloud_credentials_whatsapp_unique")) {
      await queryInterface.addIndex(table, ["whatsappId"], {
        name: "meta_cloud_credentials_whatsapp_unique",
        unique: true
      });
    }
    if (!indexes.has("meta_cloud_credentials_public_id_unique")) {
      await queryInterface.addIndex(table, ["publicId"], {
        name: "meta_cloud_credentials_public_id_unique",
        unique: true
      });
    }
    if (!indexes.has("meta_cloud_credentials_company_phone_unique")) {
      await queryInterface.addIndex(table, ["companyId", "phoneNumberId"], {
        name: "meta_cloud_credentials_company_phone_unique",
        unique: true
      });
    }
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable(table);
    await queryInterface.removeColumn("Whatsapps", "baileysMode");
    await queryInterface.removeColumn("Whatsapps", "channelType");
  }
};
