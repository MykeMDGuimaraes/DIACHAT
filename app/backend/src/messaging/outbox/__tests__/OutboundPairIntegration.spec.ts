import { randomUUID } from "crypto";
import sequelize from "../../../database";
import {
  RetryableSendError,
  UnknownSendError
} from "../../contracts/ProviderSendError";
import {
  MESSAGE_COMMAND_STATUS,
  OUTBOX_EVENT_STATUS,
  OUTBOX_EVENT_TYPE
} from "../../domain/MessagingStates";
import MessageCommand from "../../persistence/models/MessageCommand";
import MessagingOutboxEvent from "../../persistence/models/MessagingOutboxEvent";
import MessageCommandDispatcher from "../MessageCommandDispatcher";
import OutboundPairRecoveryService from "../OutboundPairRecoveryService";

const refs = { companyId: 0, whatsappId: 0 };

jest.setTimeout(15_000);

const createPair = async (
  overrides: Partial<Record<string, unknown>> = {}
): Promise<{ command: MessageCommand; event: MessagingOutboxEvent }> => {
  const command = await MessageCommand.create({
    companyId: refs.companyId,
    whatsappId: refs.whatsappId,
    provider: "baileys",
    messageKind: "text",
    recipient: "5531999999999",
    idempotencyScope: "test",
    idempotencyKey: randomUUID(),
    requestFingerprint: randomUUID(),
    status: MESSAGE_COMMAND_STATUS.QUEUED,
    requestPayload: { ticketId: 1, text: "oi" },
    ...overrides
  } as any);
  const event = await MessagingOutboxEvent.create({
    companyId: refs.companyId,
    eventType: OUTBOX_EVENT_TYPE.MESSAGE_DISPATCH_REQUESTED,
    aggregateId: command.id,
    payload: { commandId: command.id },
    status: OUTBOX_EVENT_STATUS.READY,
    availableAt: new Date(Date.now() - 1000)
  } as any);
  return { command, event };
};

const dispatcherWith = (send: (command: any) => Promise<any>) =>
  new MessageCommandDispatcher(undefined, [
    { provider: "baileys", send } as any
  ]);

describe("outbound pair dispatch + fencing (banco real)", () => {
  beforeAll(async () => {
    const [companyRows] = await sequelize.query(
      `INSERT INTO "Companies" ("name", "createdAt", "updatedAt")
       VALUES ('Empresa Outbound ' || gen_random_uuid() || '', NOW(), NOW()) RETURNING "id"`
    );
    refs.companyId = (companyRows as Array<{ id: number }>)[0].id;
    const [whatsappRows] = await sequelize.query(
      `INSERT INTO "Whatsapps" ("name", "status", "companyId", "createdAt", "updatedAt")
       VALUES ('Canal Outbound ' || gen_random_uuid() || '', 'CONNECTED', ${refs.companyId}, NOW(), NOW()) RETURNING "id"`
    );
    refs.whatsappId = (whatsappRows as Array<{ id: number }>)[0].id;
  });

  beforeEach(async () => {
    await MessagingOutboxEvent.destroy({ where: {}, force: true });
    await MessageCommand.destroy({ where: {}, force: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it("finaliza o par como sent e publica message.sent com leaseToken compartilhado", async () => {
    const { command, event } = await createPair();

    const result = await dispatcherWith(async () => ({
      providerMessageId: "wamid.99"
    })).dispatchOne();

    expect(result.status).toBe("sent");
    await command.reload();
    const reloadedEvent = await MessagingOutboxEvent.findByPk(event.id);
    expect(command.status).toBe(MESSAGE_COMMAND_STATUS.SENT);
    expect(command.providerMessageId).toBe("wamid.99");
    expect(command.leaseToken).toBeNull();
    expect(reloadedEvent!.status).toBe(OUTBOX_EVENT_STATUS.COMPLETED);
    const sentEvent = await MessagingOutboxEvent.findOne({
      where: { eventType: OUTBOX_EVENT_TYPE.MESSAGE_SENT }
    });
    expect(sentEvent).not.toBeNull();
    expect((sentEvent!.payload as any).commandId).toBe(command.id);
  });

  it("reagenda retryable como queued + ready com availableAt futuro", async () => {
    const { command, event } = await createPair();

    const result = await dispatcherWith(async () => {
      throw new RetryableSendError({
        code: "META_SERVER_ERROR",
        message: "500"
      });
    }).dispatchOne();

    expect(result.status).toBe("retry_scheduled");
    await command.reload();
    const reloadedEvent = await MessagingOutboxEvent.findByPk(event.id);
    expect(command.status).toBe(MESSAGE_COMMAND_STATUS.QUEUED);
    expect(command.attemptCount).toBe(1);
    expect(reloadedEvent!.status).toBe(OUTBOX_EVENT_STATUS.READY);
    expect(reloadedEvent!.availableAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("na 8a falha retryable vai para dead_letter e publica message.failed", async () => {
    const { command, event } = await createPair({ attemptCount: 7 });

    const result = await dispatcherWith(async () => {
      throw new RetryableSendError({
        code: "META_SERVER_ERROR",
        message: "500"
      });
    }).dispatchOne();

    expect(result.status).toBe("dead_letter");
    await command.reload();
    const reloadedEvent = await MessagingOutboxEvent.findByPk(event.id);
    expect(command.status).toBe(MESSAGE_COMMAND_STATUS.FAILED);
    expect(command.errorCode).toBe("SEND_RETRY_EXHAUSTED");
    expect(reloadedEvent!.status).toBe(OUTBOX_EVENT_STATUS.DEAD_LETTER);
    const failedEvent = await MessagingOutboxEvent.findOne({
      where: { eventType: OUTBOX_EVENT_TYPE.MESSAGE_FAILED }
    });
    expect(failedEvent).not.toBeNull();
  });

  it("unknown nunca reenfileira e publica message.status.updated", async () => {
    const { command } = await createPair();

    const result = await dispatcherWith(async () => {
      throw new UnknownSendError({
        code: "BAILEYS_SEND_TIMEOUT",
        message: "timeout"
      });
    }).dispatchOne();

    expect(result.status).toBe("unknown");
    await command.reload();
    expect(command.status).toBe(MESSAGE_COMMAND_STATUS.UNKNOWN);
    const statusEvent = await MessagingOutboxEvent.findOne({
      where: { eventType: OUTBOX_EVENT_TYPE.MESSAGE_STATUS_UPDATED }
    });
    expect(statusEvent).not.toBeNull();
  });

  it("fencing: worker atrasado nao finaliza par ja recuperado", async () => {
    const { command, event } = await createPair();

    let releaseSend: () => void = () => undefined;
    const sendGate = new Promise<void>(resolve => {
      releaseSend = resolve;
    });

    const slowDispatch = dispatcherWith(async () => {
      await sendGate;
      return { providerMessageId: "wamid.stale" };
    }).dispatchOne();

    // Espera o claim acontecer
    await new Promise(resolve => setTimeout(resolve, 300));
    await command.reload();
    expect(command.status).toBe(MESSAGE_COMMAND_STATUS.SENDING);

    // Recovery expira o lease e marca unknown antes do worker terminar
    await MessageCommand.update(
      { leaseExpiresAt: new Date(Date.now() - 1000) },
      { where: { id: command.id } }
    );
    await MessagingOutboxEvent.update(
      { leaseExpiresAt: new Date(Date.now() - 1000) },
      { where: { id: event.id } }
    );
    await new OutboundPairRecoveryService().recover();

    await command.reload();
    expect(command.status).toBe(MESSAGE_COMMAND_STATUS.UNKNOWN);

    releaseSend();
    const staleResult = await slowDispatch;
    expect(staleResult.status).toBe("fenced");

    await command.reload();
    expect(command.status).toBe(MESSAGE_COMMAND_STATUS.UNKNOWN);
    expect(command.providerMessageId).toBeNull();
    const sentEvents = await MessagingOutboxEvent.count({
      where: { eventType: OUTBOX_EVENT_TYPE.MESSAGE_SENT }
    });
    expect(sentEvents).toBe(0);
  });

  it("recovery reabre evento processing quando comando voltou a queued", async () => {
    const { command, event } = await createPair();
    await event.update({
      status: OUTBOX_EVENT_STATUS.PROCESSING,
      leaseExpiresAt: new Date(Date.now() - 1000),
      leaseToken: randomUUID()
    });

    const { recovered } = await new OutboundPairRecoveryService().recover();

    expect(recovered).toBe(1);
    const reloadedEvent = await MessagingOutboxEvent.findByPk(event.id);
    expect(reloadedEvent!.status).toBe(OUTBOX_EVENT_STATUS.READY);
    expect(reloadedEvent!.leaseToken).toBeNull();
    await command.reload();
    expect(command.status).toBe(MESSAGE_COMMAND_STATUS.QUEUED);
  });

  it("recovery conclui evento orfao de comando terminal", async () => {
    const { command, event } = await createPair({
      status: MESSAGE_COMMAND_STATUS.SENT
    });
    await event.update({
      status: OUTBOX_EVENT_STATUS.PROCESSING,
      leaseExpiresAt: new Date(Date.now() - 1000)
    });

    await new OutboundPairRecoveryService().recover();

    const reloadedEvent = await MessagingOutboxEvent.findByPk(event.id);
    expect(reloadedEvent!.status).toBe(OUTBOX_EVENT_STATUS.COMPLETED);
    await command.reload();
    expect(command.status).toBe(MESSAGE_COMMAND_STATUS.SENT);
  });
});
