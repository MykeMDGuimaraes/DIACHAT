import { DataTypes } from "sequelize";

const migration = require("../20260724000011-add-messaging-inbox-availability");

describe("20260724000011-add-messaging-inbox-availability", () => {
  it("adds durable scheduling and dispatch index", async () => {
    const queryInterface = {
      addColumn: jest.fn().mockResolvedValue(undefined),
      addIndex: jest.fn().mockResolvedValue(undefined)
    };

    await migration.up(queryInterface);

    expect(queryInterface.addColumn).toHaveBeenCalledWith(
      { tableName: "MessagingInboxEvents", schema: "messaging" },
      "availableAt",
      expect.objectContaining({
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      })
    );
    expect(queryInterface.addIndex).toHaveBeenCalledWith(
      { tableName: "MessagingInboxEvents", schema: "messaging" },
      ["provider", "status", "availableAt", "createdAt"],
      { name: "messaging_inbox_events_dispatch" }
    );
  });
});
