const migration = require("../20260728000012-add-router-integration-contract");

export {};

describe("Router integration contract migration", () => {
  it("adds message correlation and creates durable conversation state and commands", async () => {
    const addColumn = jest.fn();
    const createTable = jest.fn();
    const addIndex = jest.fn();

    // Simula banco limpo (sem drift): nenhuma coluna/tabela/índice existe,
    // então todos os guards deixam as operações executarem.
    await migration.up({
      addColumn,
      createTable,
      addIndex,
      describeTable: jest.fn().mockResolvedValue({}),
      sequelize: { query: jest.fn().mockResolvedValue([[], undefined]) }
    });

    const messageCommands = {
      tableName: "MessageCommands",
      schema: "messaging"
    };
    expect(addColumn).toHaveBeenCalledWith(
      messageCommands,
      "externalTicketId",
      expect.any(Object)
    );
    expect(addColumn).toHaveBeenCalledWith(
      messageCommands,
      "automationEpoch",
      expect.any(Object)
    );
    expect(createTable).toHaveBeenCalledWith(
      {
        tableName: "ConversationAutomationStates",
        schema: "messaging"
      },
      expect.objectContaining({
        companyId: expect.any(Object),
        externalTicketId: expect.any(Object),
        conversationId: expect.any(Object),
        automationEpoch: expect.any(Object),
        state: expect.any(Object)
      })
    );
    expect(createTable).toHaveBeenCalledWith(
      { tableName: "ConversationCommands", schema: "messaging" },
      expect.objectContaining({
        idempotencyKey: expect.any(Object),
        action: expect.any(Object),
        requestFingerprint: expect.any(Object)
      })
    );
    expect(addIndex).toHaveBeenCalledWith(
      {
        tableName: "ConversationAutomationStates",
        schema: "messaging"
      },
      ["companyId", "externalTicketId"],
      expect.objectContaining({ unique: true })
    );
  });
});
