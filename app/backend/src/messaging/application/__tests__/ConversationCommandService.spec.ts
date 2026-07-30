import ConversationCommandService from "../ConversationCommandService";

describe("ConversationCommandService", () => {
  const input = {
    companyId: 7,
    allowedConnectionIds: [2],
    idempotencyScope: "cred_1",
    idempotencyKey: "handoff-ticket-123",
    conversationId: "conversation-uuid",
    externalTicketId: "ticket-uuid",
    automationEpoch: 4,
    action: "takeover" as const,
    queueId: "12",
    userId: "9"
  };

  const dependencies = () => {
    const state = {
      state: "automation",
      automationEpoch: 3,
      conversationId: "conversation-uuid",
      update: jest.fn()
    };
    return {
      transaction: async (callback: (transaction: any) => Promise<any>) =>
        callback({ id: "tx_1" }),
      findCommand: jest.fn().mockResolvedValue(null),
      findTicket: jest.fn().mockResolvedValue({
        id: 55,
        uuid: "conversation-uuid",
        whatsappId: 2,
        contactId: 8
      }),
      findQueue: jest.fn().mockResolvedValue({ id: 12 }),
      findUser: jest.fn().mockResolvedValue({ id: 9 }),
      findState: jest.fn().mockResolvedValue(state),
      createState: jest.fn(),
      updateState: jest.fn().mockResolvedValue(state),
      cancelOlderMessages: jest.fn(),
      createCommand: jest.fn().mockResolvedValue({
        id: "conversation-command-1",
        status: "queued",
        conversationId: "conversation-uuid"
      }),
      createOutboxEvent: jest.fn(),
      state
    };
  };

  it("durably starts takeover and cancels lower epochs before returning", async () => {
    const deps = dependencies();
    const service = new ConversationCommandService(deps);
    jest
      .spyOn(service, "createCommandId")
      .mockReturnValue("conversation-command-1");

    await expect(service.create(input)).resolves.toMatchObject({
      replayed: false,
      command: { id: "conversation-command-1" }
    });

    expect(deps.updateState).toHaveBeenCalledWith(
      deps.state,
      {
        automationEpoch: 4,
        conversationId: "conversation-uuid",
        state: "pause_pending"
      },
      expect.anything()
    );
    expect(deps.cancelOlderMessages).toHaveBeenCalledWith(
      7,
      "ticket-uuid",
      4,
      expect.anything()
    );
    expect(deps.createOutboxEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "conversation.command.requested",
        aggregateId: "conversation-command-1"
      }),
      expect.anything()
    );
    expect(deps.createCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "conversation-command-1",
        responseSnapshot: {
          id: "conversation-command-1",
          status: "accepted",
          conversationId: "conversation-uuid"
        }
      }),
      expect.anything()
    );
  });

  it("rejects a handoff with an epoch below the canonical state", async () => {
    const deps = dependencies();
    deps.findState.mockResolvedValue({
      state: "automation",
      automationEpoch: 5,
      conversationId: "conversation-uuid"
    });
    const service = new ConversationCommandService(deps);

    await expect(service.create(input)).rejects.toMatchObject({
      statusCode: 409,
      message: "STALE_AUTOMATION_EPOCH"
    });
  });

  it("rejects finalize when native survey is not explicitly false", async () => {
    const service = new ConversationCommandService(dependencies());

    await expect(
      service.create({
        ...input,
        action: "finalize",
        sendNativeSurvey: true
      })
    ).rejects.toMatchObject({
      statusCode: 422,
      message: "NATIVE_SURVEY_NOT_ALLOWED"
    });
  });

  it("replays the winner of a concurrent idempotency insert", async () => {
    const deps = dependencies();
    const winner = {
      id: "winner",
      requestFingerprint: "same",
      responseSnapshot: {
        id: "winner",
        status: "accepted",
        conversationId: "conversation-uuid"
      }
    };
    deps.transaction = async callback => {
      await callback({ id: "tx_1" });
      throw { name: "SequelizeUniqueConstraintError" };
    };
    deps.findCommand
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    const service = new ConversationCommandService(deps);
    jest.spyOn(service, "fingerprint").mockReturnValue("same");

    await expect(service.create(input)).resolves.toEqual({
      command: winner,
      replayed: true
    });
  });
});
