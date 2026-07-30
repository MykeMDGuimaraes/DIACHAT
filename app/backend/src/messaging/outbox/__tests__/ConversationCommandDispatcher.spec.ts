import sequelize from "../../../database";
import Ticket from "../../../models/Ticket";
import ConversationAutomationState from "../../persistence/models/ConversationAutomationState";
import ConversationCommand from "../../persistence/models/ConversationCommand";
import MessagingOutboxEvent from "../../persistence/models/MessagingOutboxEvent";
import ConversationCommandDispatcher, {
  buildConversationResultEvent,
  buildConversationUpdatedEvent,
  executeConversationCommandAndComplete,
  failConversationCommand,
  retryConversationCommand
} from "../ConversationCommandDispatcher";

const claim = {
  eventId: "outbox-1",
  leaseToken: "lease-1",
  command: {
    id: "command-1",
    companyId: 7,
    conversationId: "conversation-uuid",
    externalTicketId: "ticket-uuid",
    automationEpoch: 4,
    action: "takeover",
    queueId: "12",
    userId: "9",
    attemptCount: 1,
    requestPayload: { ticketId: 55, contactId: 8, whatsappId: 2 }
  }
};

describe("ConversationCommandDispatcher", () => {
  it("executes a claimed handoff and completes the durable pair", async () => {
    const executeAndComplete = jest.fn().mockResolvedValue("completed");
    const dispatcher = new ConversationCommandDispatcher({
      claimNext: jest.fn().mockResolvedValue(claim),
      executeAndComplete,
      retry: jest.fn(),
      fail: jest.fn(),
      now: jest.fn()
    });

    await expect(dispatcher.dispatchOne()).resolves.toEqual({
      status: "completed"
    });
    expect(executeAndComplete).toHaveBeenCalledWith(claim);
  });

  it("returns fenced without applying a stale worker result", async () => {
    const dispatcher = new ConversationCommandDispatcher({
      claimNext: jest.fn().mockResolvedValue(claim),
      executeAndComplete: jest.fn().mockResolvedValue("fenced"),
      retry: jest.fn(),
      fail: jest.fn(),
      now: jest.fn()
    });

    await expect(dispatcher.dispatchOne()).resolves.toEqual({
      status: "fenced"
    });
  });

  it("requeues a transient failure with bounded backoff", async () => {
    const retry = jest.fn();
    const now = new Date("2026-07-28T20:00:00.000Z");
    const dispatcher = new ConversationCommandDispatcher({
      claimNext: jest.fn().mockResolvedValue(claim),
      executeAndComplete: jest
        .fn()
        .mockRejectedValue(new Error("database unavailable")),
      retry,
      fail: jest.fn(),
      now: jest.fn().mockReturnValue(now)
    });

    await expect(dispatcher.dispatchOne()).resolves.toEqual({
      status: "retry"
    });
    expect(retry).toHaveBeenCalledWith(
      claim,
      new Date("2026-07-28T20:00:05.000Z"),
      "CONVERSATION_COMMAND_RETRYABLE"
    );
  });

  it("creates the correlated paused event without message content or phone", () => {
    expect(buildConversationResultEvent(claim.command as any)).toEqual({
      companyId: 7,
      eventType: "handoff.paused",
      aggregateId: "conversation-uuid",
      payload: {
        commandId: "command-1",
        conversationId: "conversation-uuid",
        contactId: "8",
        whatsappId: 2,
        externalTicketId: "ticket-uuid",
        automationEpoch: 4,
        actorType: "system",
        origin: "api"
      },
      status: "ready",
      attemptCount: 0
    });
  });

  it("does not publish a native survey event when finalizing", () => {
    expect(
      buildConversationResultEvent({
        ...claim.command,
        action: "finalize"
      } as any)
    ).toBeUndefined();
  });

  it("publishes a correlated conversation update for every command", () => {
    expect(buildConversationUpdatedEvent(claim.command as any)).toEqual(
      expect.objectContaining({
        eventType: "conversation.updated",
        aggregateId: "conversation-uuid",
        payload: expect.objectContaining({
          commandId: "command-1",
          action: "takeover",
          externalTicketId: "ticket-uuid",
          automationEpoch: 4
        })
      })
    );
  });

  it("locks Ticket, state, outbox and command in the global order", async () => {
    const order: string[] = [];
    const ticket = { update: jest.fn() };
    const state = {
      state: "pause_pending",
      automationEpoch: 4,
      update: jest.fn()
    };
    const event = {
      status: "processing",
      leaseToken: "lease-1",
      update: jest.fn()
    };
    const command = {
      status: "processing",
      leaseToken: "lease-1",
      leaseExpiresAt: new Date(Date.now() + 60_000),
      update: jest.fn()
    };
    jest
      .spyOn(sequelize, "transaction")
      .mockImplementation((async (callback: any) =>
        callback({ LOCK: { UPDATE: "UPDATE" } })) as any);
    jest.spyOn(Ticket, "findOne").mockImplementation((async () => {
      order.push("ticket");
      return ticket;
    }) as any);
    jest
      .spyOn(ConversationAutomationState, "findOne")
      .mockImplementation((async () => {
        order.push("state");
        return state;
      }) as any);
    jest
      .spyOn(MessagingOutboxEvent, "findOne")
      .mockImplementation((async () => {
        order.push("event");
        return event;
      }) as any);
    jest.spyOn(ConversationCommand, "findOne").mockImplementation((async () => {
      order.push("command");
      return command;
    }) as any);
    jest.spyOn(MessagingOutboxEvent, "create").mockResolvedValue({} as any);

    await expect(
      executeConversationCommandAndComplete(claim as any)
    ).resolves.toBe("completed");
    expect(order).toEqual(["ticket", "state", "event", "command"]);
  });

  it("updates the durable pair in event then command order on retry and failure", async () => {
    const order: string[] = [];
    jest.spyOn(MessagingOutboxEvent, "update").mockImplementation((async () => {
      order.push("event");
      return [1];
    }) as any);
    jest.spyOn(ConversationCommand, "update").mockImplementation((async () => {
      order.push("command");
      return [1];
    }) as any);

    await retryConversationCommand(
      claim as any,
      new Date("2026-07-28T20:00:05.000Z"),
      "RETRYABLE"
    );
    await failConversationCommand(claim as any, "PERMANENT");

    expect(order).toEqual(["event", "command", "event", "command"]);
  });
});
