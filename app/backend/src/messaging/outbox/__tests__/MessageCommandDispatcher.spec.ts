import {
  PermanentSendError,
  RetryableSendError,
  UnknownSendError
} from "../../contracts/ProviderSendError";
import {
  BACKOFF_MAX_MS,
  computeRetryDelayMs,
  MAX_SEND_ATTEMPTS
} from "../../domain/MessagingStates";
import sequelize from "../../../database";
import MessageCommand from "../../persistence/models/MessageCommand";
import MessagingOutboxEvent from "../../persistence/models/MessagingOutboxEvent";
import MessageCommandDispatcher, {
  automationCommandIsCurrent,
  buildMessageFailedEvent,
  buildMessageSentEvent,
  buildMessageUnknownEvent,
  MessageCommandDispatcherDependencies
} from "../MessageCommandDispatcher";

const command = {
  id: "cmd_1",
  companyId: 7,
  whatsappId: 42,
  messageId: "msg_1",
  messageKind: "text",
  provider: "baileys",
  recipient: "5531999999999",
  requestPayload: { text: "Ola" }
  ,
  externalTicketId: "ticket-uuid",
  automationEpoch: 4,
  conversationId: "conversation-uuid",
  contactId: "8"
} as any;

const claim = (attemptCount = 1) => ({
  eventId: "outbox_1",
  leaseToken: "lease-token-1",
  attemptCount,
  command
});

const buildDependencies = (
  overrides: Partial<MessageCommandDispatcherDependencies> = {}
): MessageCommandDispatcherDependencies => ({
  claimNext: jest.fn().mockResolvedValue(claim()),
  send: jest.fn().mockResolvedValue({ providerMessageId: "wamid_1" }),
  markSent: jest.fn().mockResolvedValue(true),
  scheduleRetry: jest.fn().mockResolvedValue(true),
  markFailed: jest.fn().mockResolvedValue(true),
  markDeadLetter: jest.fn().mockResolvedValue(true),
  markUnknown: jest.fn().mockResolvedValue(true),
  random: () => 0.5,
  ...overrides
});

describe("MessageCommandDispatcher", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("classifies a missing provider as permanent", async () => {
    const dispatcher = new MessageCommandDispatcher(undefined, []);
    const dependencies = (dispatcher as any).dependencies;
    dependencies.claimNext = jest.fn().mockResolvedValue(claim());
    dependencies.withSendPermit = undefined;
    dependencies.markFailed = jest.fn().mockResolvedValue(true);
    dependencies.markUnknown = jest.fn().mockResolvedValue(true);

    await expect(dispatcher.dispatchOne()).resolves.toEqual({
      status: "failed"
    });
    expect(dependencies.markFailed).toHaveBeenCalledWith(
      claim(),
      expect.objectContaining({
        classification: "permanent",
        code: "PROVIDER_NOT_SUPPORTED"
      })
    );
    expect(dependencies.markUnknown).not.toHaveBeenCalled();
  });

  it("delivers a claimed command and finalizes the pair as sent", async () => {
    const dependencies = buildDependencies();
    const dispatcher = new MessageCommandDispatcher(dependencies);

    await expect(dispatcher.dispatchOne()).resolves.toEqual({ status: "sent" });
    expect(dependencies.markSent).toHaveBeenCalledWith(claim(), "wamid_1");
  });

  it("does not call the provider when a pause wins the final send permit", async () => {
    const send = jest
      .fn()
      .mockResolvedValue({ providerMessageId: "must-not-send" });
    const dependencies = buildDependencies({
      send,
      withSendPermit: jest.fn().mockResolvedValue({ status: "cancelled" })
    });
    const dispatcher = new MessageCommandDispatcher(dependencies);

    await expect(dispatcher.dispatchOne()).resolves.toEqual({
      status: "cancelled"
    });
    expect(send).not.toHaveBeenCalled();
    expect(dependencies.markSent).not.toHaveBeenCalled();
  });

  it("does nothing when no outbox event is ready", async () => {
    const dependencies = buildDependencies({
      claimNext: jest.fn().mockResolvedValue(null)
    });
    const dispatcher = new MessageCommandDispatcher(dependencies);

    await expect(dispatcher.dispatchOne()).resolves.toEqual({ status: "idle" });
    expect(dependencies.send).not.toHaveBeenCalled();
  });

  it("schedules a retry with backoff for retryable errors", async () => {
    const error = new RetryableSendError({
      code: "META_SERVER_ERROR",
      message: "500 da Meta"
    });
    const dependencies = buildDependencies({
      send: jest.fn().mockRejectedValue(error)
    });
    const dispatcher = new MessageCommandDispatcher(dependencies);
    const now = new Date("2026-07-24T12:00:00.000Z");

    await expect(dispatcher.dispatchOne(now)).resolves.toEqual({
      status: "retry_scheduled"
    });

    const [claimArg, errorArg, availableAt] = (
      dependencies.scheduleRetry as jest.Mock
    ).mock.calls[0];
    expect(claimArg.command.id).toBe("cmd_1");
    expect(errorArg).toBe(error);
    // attempt 1, base 5s, jitter fixo 1.0 (random=0.5)
    expect(availableAt.getTime() - now.getTime()).toBe(5000);
  });

  it("respects Retry-After when larger than the backoff", async () => {
    const error = new RetryableSendError({
      code: "META_RATE_LIMITED",
      message: "429",
      retryAfterMs: 60_000
    });
    const dependencies = buildDependencies({
      send: jest.fn().mockRejectedValue(error)
    });
    const dispatcher = new MessageCommandDispatcher(dependencies);
    const now = new Date("2026-07-24T12:00:00.000Z");

    await dispatcher.dispatchOne(now);

    const [, , availableAt] = (dependencies.scheduleRetry as jest.Mock).mock
      .calls[0];
    expect(availableAt.getTime() - now.getTime()).toBe(60_000);
  });

  it("dead-letters a retryable error at the max attempt", async () => {
    const error = new RetryableSendError({
      code: "META_SERVER_ERROR",
      message: "500 da Meta"
    });
    const dependencies = buildDependencies({
      claimNext: jest.fn().mockResolvedValue(claim(MAX_SEND_ATTEMPTS)),
      send: jest.fn().mockRejectedValue(error)
    });
    const dispatcher = new MessageCommandDispatcher(dependencies);

    await expect(dispatcher.dispatchOne()).resolves.toEqual({
      status: "dead_letter"
    });
    expect(dependencies.markDeadLetter).toHaveBeenCalled();
    expect(dependencies.scheduleRetry).not.toHaveBeenCalled();
  });

  it("fails permanently without retry for permanent errors", async () => {
    const error = new PermanentSendError({
      code: "META_REQUEST_REJECTED",
      message: "payload invalido"
    });
    const dependencies = buildDependencies({
      send: jest.fn().mockRejectedValue(error)
    });
    const dispatcher = new MessageCommandDispatcher(dependencies);

    await expect(dispatcher.dispatchOne()).resolves.toEqual({
      status: "failed"
    });
    expect(dependencies.markFailed).toHaveBeenCalled();
    expect(dependencies.scheduleRetry).not.toHaveBeenCalled();
  });

  it("never retries unknown outcomes", async () => {
    const error = new UnknownSendError({
      code: "BAILEYS_SEND_TIMEOUT",
      message: "timeout apos envio"
    });
    const dependencies = buildDependencies({
      send: jest.fn().mockRejectedValue(error)
    });
    const dispatcher = new MessageCommandDispatcher(dependencies);

    await expect(dispatcher.dispatchOne()).resolves.toEqual({
      status: "unknown"
    });
    expect(dependencies.markUnknown).toHaveBeenCalledWith(
      claim(),
      "timeout apos envio"
    );
    expect(dependencies.scheduleRetry).not.toHaveBeenCalled();
  });

  it("treats unclassified errors as unknown, never inferring by message", async () => {
    const dependencies = buildDependencies({
      send: jest.fn().mockRejectedValue(new Error("socket timeout"))
    });
    const dispatcher = new MessageCommandDispatcher(dependencies);

    await expect(dispatcher.dispatchOne()).resolves.toEqual({
      status: "unknown"
    });
  });

  it("reports fenced when a stale lease loses the finalization race", async () => {
    const dependencies = buildDependencies({
      markSent: jest.fn().mockResolvedValue(false)
    });
    const dispatcher = new MessageCommandDispatcher(dependencies);

    await expect(dispatcher.dispatchOne()).resolves.toEqual({
      status: "fenced"
    });
  });

  it("rolls back and fences when the outbox side of the leased pair diverges", async () => {
    let transactionRolledBack = false;
    jest.spyOn(sequelize, "transaction").mockImplementation((async (
      callback: (transaction: any) => unknown
    ) => {
      try {
        return await callback({ LOCK: { UPDATE: "UPDATE" } });
      } catch (error) {
        transactionRolledBack = true;
        throw error;
      }
    }) as any);
    jest.spyOn(MessageCommand, "update").mockResolvedValue([1] as any);
    jest.spyOn(MessagingOutboxEvent, "update").mockResolvedValue([0] as any);
    const createFollowUp = jest
      .spyOn(MessagingOutboxEvent, "create")
      .mockResolvedValue({} as any);

    const dispatcher = new MessageCommandDispatcher(undefined, []);
    const finalized = await (dispatcher as any).dependencies.markSent(
      claim(),
      "wamid.divergent"
    );

    expect(finalized).toBe(false);
    expect(transactionRolledBack).toBe(true);
    expect(createFollowUp).not.toHaveBeenCalled();
  });

  it("builds the durable events with typed payloads", () => {
    expect(buildMessageSentEvent(command, "wamid.1")).toEqual(
      expect.objectContaining({
        eventType: "message.sent",
        aggregateId: "msg_1",
        payload: expect.objectContaining({
          providerMessageId: "wamid.1",
          kind: "text",
          origin: "api",
          conversationId: "conversation-uuid",
          contactId: "8",
          externalTicketId: "ticket-uuid",
          automationEpoch: 4
        })
      })
    );
    expect(
      buildMessageFailedEvent(command, "SEND_RETRY_EXHAUSTED", "esgotado")
    ).toEqual(
      expect.objectContaining({
        eventType: "message.failed",
        payload: expect.objectContaining({
          errorCode: "SEND_RETRY_EXHAUSTED",
          status: "failed"
        })
      })
    );
    expect(buildMessageUnknownEvent(command, "lease expirado")).toEqual(
      expect.objectContaining({
        eventType: "message.status.updated",
        payload: expect.objectContaining({ status: "unknown" })
      })
    );
  });

  it("keeps a disconnected Baileys command queued without exhausting provider attempts", async () => {
    const error = new RetryableSendError({
      code: "BAILEYS_SOCKET_UNAVAILABLE",
      message: "sessao desconectada"
    });
    const dependencies = buildDependencies({
      claimNext: jest.fn().mockResolvedValue(claim(MAX_SEND_ATTEMPTS)),
      send: jest.fn().mockRejectedValue(error)
    });
    const dispatcher = new MessageCommandDispatcher(dependencies);
    const now = new Date("2026-07-24T12:00:00.000Z");

    await expect(dispatcher.dispatchOne(now)).resolves.toEqual({
      status: "retry_scheduled"
    });
    expect(dependencies.markDeadLetter).not.toHaveBeenCalled();
    const [, , availableAt] = (dependencies.scheduleRetry as jest.Mock).mock
      .calls[0];
    expect(availableAt).toEqual(new Date("2026-07-24T12:00:30.000Z"));
  });

  it("rejects stale or human-controlled automation immediately before send", () => {
    expect(
      automationCommandIsCurrent(command, {
        state: "automation",
        automationEpoch: 4,
        conversationId: "conversation-uuid"
      })
    ).toBe(true);
    expect(
      automationCommandIsCurrent(command, {
        state: "human_controlled",
        automationEpoch: 4,
        conversationId: "conversation-uuid"
      })
    ).toBe(false);
    expect(
      automationCommandIsCurrent(command, {
        state: "automation",
        automationEpoch: 5,
        conversationId: "conversation-uuid"
      })
    ).toBe(false);
  });
});

describe("computeRetryDelayMs", () => {
  it("grows exponentially with jitter and caps at 15 minutes", () => {
    expect(computeRetryDelayMs({ attempt: 1, random: () => 0.5 })).toBe(5000);
    expect(computeRetryDelayMs({ attempt: 2, random: () => 0.5 })).toBe(10_000);
    expect(computeRetryDelayMs({ attempt: 20, random: () => 0.5 })).toBe(
      BACKOFF_MAX_MS
    );
    // jitter 0.5..1.5
    expect(computeRetryDelayMs({ attempt: 1, random: () => 0 })).toBe(2500);
    expect(computeRetryDelayMs({ attempt: 1, random: () => 1 })).toBe(7500);
  });

  it("uses max(backoff, retryAfter)", () => {
    expect(
      computeRetryDelayMs({
        attempt: 1,
        retryAfterMs: 30_000,
        random: () => 0.5
      })
    ).toBe(30_000);
    expect(
      computeRetryDelayMs({
        attempt: 10,
        retryAfterMs: 1000,
        random: () => 0.5
      })
    ).toBe(BACKOFF_MAX_MS);
  });
});
