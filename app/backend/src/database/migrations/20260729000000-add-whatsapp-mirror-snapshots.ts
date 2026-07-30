import { DataTypes, QueryInterface } from "sequelize";

const outbox = {
  tableName: "MessagingOutboxEvents",
  schema: "messaging"
};
const deliveries = {
  tableName: "WebhookDeliveries",
  schema: "messaging"
};
const chatStates = {
  tableName: "WhatsAppChatStates",
  schema: "messaging"
};

const encryptedBodyColumns = {
  bodyCiphertext: { type: DataTypes.TEXT, allowNull: true },
  bodyKeyVersion: { type: DataTypes.STRING, allowNull: true },
  bodySha256: { type: DataTypes.STRING(64), allowNull: true },
  bodyExpiresAt: { type: DataTypes.DATE, allowNull: true },
  bodyPurgedAt: { type: DataTypes.DATE, allowNull: true }
};

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    for (const [column, definition] of Object.entries(encryptedBodyColumns)) {
      await queryInterface.addColumn(outbox, column, definition);
      await queryInterface.addColumn(deliveries, column, definition);
    }
    await queryInterface.addColumn(deliveries, "leaseToken", {
      type: DataTypes.UUID,
      allowNull: true
    });

    await queryInterface.createTable(chatStates, {
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
        onDelete: "CASCADE",
        onUpdate: "CASCADE"
      },
      whatsappId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: { tableName: "Whatsapps", schema: "public" },
          key: "id"
        },
        onDelete: "CASCADE",
        onUpdate: "CASCADE"
      },
      jid: { type: DataTypes.STRING(191), allowNull: false },
      lid: { type: DataTypes.STRING(191), allowNull: true },
      isGroup: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      archived: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      pinned: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      mutedUntil: { type: DataTypes.DATE, allowNull: true },
      unreadCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      lastMessageId: { type: DataTypes.STRING, allowNull: true },
      lastMessageAt: { type: DataTypes.DATE, allowNull: true },
      lastMessagePreview: { type: DataTypes.TEXT, allowNull: true },
      revision: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0
      },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex(
      chatStates,
      ["companyId", "whatsappId", "jid"],
      {
        name: "whatsapp_chat_states_company_connection_jid_unique",
        unique: true
      }
    );
    await queryInterface.addIndex(
      deliveries,
      ["status", "availableAt", "leaseExpiresAt", "leaseToken"],
      { name: "webhook_deliveries_fenced_dispatch" }
    );
    await queryInterface.addIndex(
      deliveries,
      ["bodyExpiresAt", "bodyPurgedAt"],
      { name: "webhook_deliveries_body_expiry" }
    );
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.removeIndex(
      deliveries,
      "webhook_deliveries_body_expiry"
    );
    await queryInterface.removeIndex(
      deliveries,
      "webhook_deliveries_fenced_dispatch"
    );
    await queryInterface.dropTable(chatStates);
    await queryInterface.removeColumn(deliveries, "leaseToken");
    for (const column of Object.keys(encryptedBodyColumns).reverse()) {
      await queryInterface.removeColumn(deliveries, column);
      await queryInterface.removeColumn(outbox, column);
    }
  }
};
