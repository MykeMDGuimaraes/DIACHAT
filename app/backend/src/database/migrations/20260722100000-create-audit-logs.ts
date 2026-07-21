import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("AuditLogs", {
      id: {
        type: DataTypes.BIGINT,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      companyId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      actorType: {
        type: DataTypes.STRING,
        allowNull: false
      },
      actorId: {
        type: DataTypes.STRING,
        allowNull: true
      },
      action: {
        type: DataTypes.STRING,
        allowNull: false
      },
      targetType: {
        type: DataTypes.STRING,
        allowNull: true
      },
      targetId: {
        type: DataTypes.STRING,
        allowNull: true
      },
      outcome: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "success"
      },
      ip: {
        type: DataTypes.STRING,
        allowNull: true
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: true
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false
      }
    });
    await queryInterface.addIndex("AuditLogs", ["companyId", "createdAt"]);
    await queryInterface.addIndex("AuditLogs", ["action", "createdAt"]);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("AuditLogs");
  }
};
