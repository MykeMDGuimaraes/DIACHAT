import ConversationAutomationService from "../ConversationAutomationService";

describe("ConversationAutomationService", () => {
  const context = {
    companyId: 7,
    conversationId: "conversation-uuid",
    externalTicketId: "ticket-uuid",
    automationEpoch: 4,
    transaction: { id: "tx_1" }
  };

  it("creates the canonical automation state for the first correlated send", async () => {
    const createState = jest.fn().mockResolvedValue({
      state: "automation",
      automationEpoch: 4
    });
    const service = new ConversationAutomationService({
      findState: jest.fn().mockResolvedValue(null),
      createState,
      updateState: jest.fn(),
      cancelOlderMessages: jest.fn()
    });

    await expect(service.reserveAutomatedMessage(context)).resolves.toMatchObject({
      state: "automation",
      automationEpoch: 4
    });
    expect(createState).toHaveBeenCalledWith(
      {
        companyId: 7,
        conversationId: "conversation-uuid",
        externalTicketId: "ticket-uuid",
        automationEpoch: 4,
        state: "automation"
      },
      context.transaction
    );
  });

  it("rejects a stale epoch before a provider command can be persisted", async () => {
    const service = new ConversationAutomationService({
      findState: jest.fn().mockResolvedValue({
        state: "automation",
        automationEpoch: 5
      }),
      createState: jest.fn(),
      updateState: jest.fn(),
      cancelOlderMessages: jest.fn()
    });

    await expect(service.reserveAutomatedMessage(context)).rejects.toMatchObject({
      statusCode: 409,
      message: "STALE_AUTOMATION_EPOCH"
    });
  });

  it("returns a deterministic conflict when two first commands race", async () => {
    const service = new ConversationAutomationService({
      findState: jest.fn().mockResolvedValue(null),
      createState: jest
        .fn()
        .mockRejectedValue({ name: "SequelizeUniqueConstraintError" }),
      updateState: jest.fn(),
      cancelOlderMessages: jest.fn()
    });

    await expect(service.reserveAutomatedMessage(context)).rejects.toMatchObject({
      statusCode: 409,
      message: "CONVERSATION_STATE_CONFLICT"
    });
  });

  it("blocks sends while a human controls the conversation", async () => {
    const service = new ConversationAutomationService({
      findState: jest.fn().mockResolvedValue({
        state: "human_controlled",
        automationEpoch: 4
      }),
      createState: jest.fn(),
      updateState: jest.fn(),
      cancelOlderMessages: jest.fn()
    });

    await expect(service.reserveAutomatedMessage(context)).rejects.toMatchObject({
      statusCode: 409,
      message: "STALE_AUTOMATION_EPOCH"
    });
  });

  it("advances the epoch atomically and cancels older unsent messages", async () => {
    const state = { state: "automation", automationEpoch: 3 };
    const updateState = jest.fn().mockResolvedValue({
      state: "automation",
      automationEpoch: 4
    });
    const cancelOlderMessages = jest.fn();
    const service = new ConversationAutomationService({
      findState: jest.fn().mockResolvedValue(state),
      createState: jest.fn(),
      updateState,
      cancelOlderMessages
    });

    await service.reserveAutomatedMessage(context);

    expect(updateState).toHaveBeenCalledWith(
      state,
      { automationEpoch: 4, conversationId: "conversation-uuid" },
      context.transaction
    );
    expect(cancelOlderMessages).toHaveBeenCalledWith(
      7,
      "ticket-uuid",
      4,
      context.transaction
    );
  });
});
