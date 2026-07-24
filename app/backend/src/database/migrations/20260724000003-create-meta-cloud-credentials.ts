import { DataTypes, QueryInterface } from "sequelize";

const table = { tableName: "MetaCloudCredentials", schema: "messaging" };

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Whatsapps", "channelType", {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "baileys"
    });
    await queryInterface.addColumn("Whatsapps", "baileysMode", {
      type: DataTypes.STRING,
      allowNull: true
    });
    await queryInterface.sequelize.query(
      'UPDATE "Whatsapps" SET "baileysMode" = COALESCE("provider", \'beta\')'
    );

    await queryInterface.createTable(table, {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      companyId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      whatsappId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Whatsapps", key: "id" },
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
    await queryInterface.addIndex(table, ["whatsappId"], {
      name: "meta_cloud_credentials_whatsapp_unique",
      unique: true
    });
    await queryInterface.addIndex(table, ["publicId"], {
      name: "meta_cloud_credentials_public_id_unique",
      unique: true
    });
    await queryInterface.addIndex(table, ["companyId", "phoneNumberId"], {
      name: "meta_cloud_credentials_company_phone_unique",
      unique: true
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable(table);
    await queryInterface.removeColumn("Whatsapps", "baileysMode");
    await queryInterface.removeColumn("Whatsapps", "channelType");
  }
};
