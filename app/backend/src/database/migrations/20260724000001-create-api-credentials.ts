import { DataTypes, QueryInterface } from "sequelize";

const table = { tableName: "ApiCredentials", schema: "messaging" };

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable(table, {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false
      },
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
      name: { type: DataTypes.STRING, allowNull: false },
      tokenId: { type: DataTypes.STRING, allowNull: false },
      secretHash: { type: DataTypes.STRING, allowNull: false },
      scopes: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
      },
      connectionIds: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
      },
      revokedAt: { type: DataTypes.DATE, allowNull: true },
      lastUsedAt: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });

    await queryInterface.addIndex(table, ["tokenId"], {
      name: "api_credentials_token_id_unique",
      unique: true
    });
    await queryInterface.addIndex(table, ["companyId", "revokedAt"], {
      name: "api_credentials_company_status_index"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable(table);
  }
};
