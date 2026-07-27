import { DataTypes, QueryInterface } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.createTable(
      { schema: "messaging", tableName: "MessagingCapacitySamples" },
      {
        id: {
          type: DataTypes.UUID,
          primaryKey: true,
          defaultValue: DataTypes.UUIDV4
        },
        companyId: { type: DataTypes.INTEGER, allowNull: false },
        runId: { type: DataTypes.UUID, allowNull: false },
        status: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: "ready"
        },
        observedAt: { type: DataTypes.DATE, allowNull: true },
        createdAt: { type: DataTypes.DATE, allowNull: false }
      }
    );
    await queryInterface.addIndex(
      { schema: "messaging", tableName: "MessagingCapacitySamples" },
      ["status", "createdAt"],
      { name: "messaging_capacity_samples_status_created_at" }
    );
    await queryInterface.addIndex(
      { schema: "messaging", tableName: "MessagingCapacitySamples" },
      ["runId"],
      { name: "messaging_capacity_samples_run_id" }
    );
  },
  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.dropTable({
      schema: "messaging",
      tableName: "MessagingCapacitySamples"
    });
  }
};
