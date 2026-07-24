import { DataTypes, QueryInterface } from "sequelize";

const subscriptions = {
  tableName: "WebhookSubscriptions",
  schema: "messaging"
};
const deliveries = { tableName: "WebhookDeliveries", schema: "messaging" };

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable(subscriptions, {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      companyId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: { tableName: "Companies", schema: "public" },
          key: "id"
        },
        onDelete: "CASCADE",
        onUpdate: "CASCADE"
      },
      name: { type: DataTypes.STRING, allowNull: false },
      url: { type: DataTypes.TEXT, allowNull: false },
      enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      events: { type: DataTypes.JSONB, allowNull: false },
      connectionIds: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
      },
      messageKinds: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
      },
      includeApiOrigin: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      secretCiphertext: { type: DataTypes.TEXT, allowNull: false },
      keyVersion: { type: DataTypes.STRING, allowNull: false },
      consecutiveFailures: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      pausedAt: { type: DataTypes.DATE, allowNull: true },
      lastSuccessAt: { type: DataTypes.DATE, allowNull: true },
      lastFailureAt: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex(
      subscriptions,
      ["companyId", "enabled", "pausedAt"],
      { name: "webhook_subscriptions_dispatch" }
    );

    await queryInterface.createTable(deliveries, {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      subscriptionId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: subscriptions, key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE"
      },
      companyId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: { tableName: "Companies", schema: "public" },
          key: "id"
        },
        onDelete: "CASCADE",
        onUpdate: "CASCADE"
      },
      eventId: { type: DataTypes.STRING, allowNull: false },
      eventType: { type: DataTypes.STRING, allowNull: false },
      urlSnapshot: { type: DataTypes.TEXT, allowNull: false },
      secretCiphertextSnapshot: { type: DataTypes.TEXT, allowNull: false },
      keyVersion: { type: DataTypes.STRING, allowNull: false },
      payload: { type: DataTypes.JSONB, allowNull: false },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "ready"
      },
      attemptCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      availableAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      },
      leaseExpiresAt: { type: DataTypes.DATE, allowNull: true },
      responseStatus: { type: DataTypes.INTEGER, allowNull: true },
      responseBody: { type: DataTypes.TEXT, allowNull: true },
      lastError: { type: DataTypes.TEXT, allowNull: true },
      deliveredAt: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex(deliveries, ["subscriptionId", "eventId"], {
      name: "webhook_deliveries_subscription_event_unique",
      unique: true
    });
    await queryInterface.addIndex(
      deliveries,
      ["status", "availableAt", "leaseExpiresAt"],
      { name: "webhook_deliveries_dispatch" }
    );
  },
  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable(deliveries);
    await queryInterface.dropTable(subscriptions);
  }
};
