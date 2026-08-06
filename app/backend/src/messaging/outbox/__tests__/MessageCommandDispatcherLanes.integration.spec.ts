import { randomUUID } from "crypto";
import sequelize from "../../../database";
import {
  MESSAGE_COMMAND_STATUS,
  OUTBOX_EVENT_STATUS,
  OUTBOX_EVENT_TYPE,
  SEND_LEASE_MS
} from "../../domain/MessagingStates";
import MessageCommand from "../../persistence/models/MessageCommand";
import MessagingOutboxEvent from "../../persistence/models/MessagingOutboxEvent";
import MessageCommandDispatcher, {
  MessageCommandDispatcherDependencies
} from "../MessageCommandDispatcher";

const refs = { companyId: 0, whatsappIdA: 0, whatsappIdB: 0 };

jest.setTimeout(15_000);

const createPair = async (
  whatsappId: number,
  overrides: Partial<Record<string, unknown>> = {}
): Promise<{ command: MessageCommand; event: MessagingOutboxEvent }> => {
  const command = await MessageCommand.create({
    companyId: refs.companyId,
    whatsappId,
    provider: "baileys",
    messageKind: "text",
    recipient: "5531999999999",
    idempotencyScope: "lanes-test",
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

// Acesso às dependências padrão (banco real) para exercitar a seleção SQL.
const defaultDependencies = (
  dispatcher: MessageCommandDispatcher
): Required<
  Pick<MessageCommandDispatcherDependencies, "claimNextPerChannel">
> =>
  (dispatcher as any).dependencies as Required<
    Pick<MessageCommandDispatcherDependencies, "claimNextPerChannel">
  >;

describe("lanes por canal — seleção SQL (banco real, T8)", () => {
  beforeAll(async () => {
    const [companyRows] = await sequelize.query(
      `INSERT INTO "Companies" ("name", "createdAt", "updatedAt")
       VALUES ('Empresa Lanes ' || gen_random_uuid() || '', NOW(), NOW()) RETURNING "id"`
    );
    refs.companyId = (companyRows as Array<{ id: number }>)[0].id;
    const createChannel = async (label: string): Promise<number> => {
      const [rows] = await sequelize.query(
        `INSERT INTO "Whatsapps" ("name", "status", "companyId", "createdAt", "updatedAt")
         VALUES ('${label} ' || gen_random_uuid() || '', 'CONNECTED', ${refs.companyId}, NOW(), NOW()) RETURNING "id"`
      );
      return (rows as Array<{ id: number }>)[0].id;
    };
    refs.whatsappIdA = await createChannel("Canal Lanes A");
    refs.whatsappIdB = await createChannel("Canal Lanes B");
  });

  beforeEach(async () => {
    await MessagingOutboxEvent.destroy({ where: {}, force: true });
    await MessageCommand.destroy({ where: {}, force: true });
  });

  it("seleciona um claim por canal, sempre o comando mais antigo", async () => {
    const first = await createPair(refs.whatsappIdA);
    await new Promise(resolve => setTimeout(resolve, 10));
    await createPair(refs.whatsappIdA);
    const other = await createPair(refs.whatsappIdB);

    const dispatcher = new MessageCommandDispatcher(undefined, []);
    const claims = await defaultDependencies(dispatcher).claimNextPerChannel(
      new Date(),
      8
    );

    expect(claims).toHaveLength(2);
    const claimA = claims.find(
      claim => claim.command.whatsappId === refs.whatsappIdA
    );
    const claimB = claims.find(
      claim => claim.command.whatsappId === refs.whatsappIdB
    );
    // O canal A tem dois comandos na fila: o claim é sempre o mais antigo.
    expect(claimA?.command.id).toBe(first.command.id);
    expect(claimB?.command.id).toBe(other.command.id);
  });

  it("canal com envio em andamento (lease vigente) fica fora da rodada", async () => {
    const inFlight = await createPair(refs.whatsappIdA);
    await inFlight.command.update({
      status: MESSAGE_COMMAND_STATUS.SENDING,
      leaseToken: randomUUID(),
      leaseExpiresAt: new Date(Date.now() + SEND_LEASE_MS)
    });
    await createPair(refs.whatsappIdA); // fila do mesmo canal
    const other = await createPair(refs.whatsappIdB);

    const dispatcher = new MessageCommandDispatcher(undefined, []);
    const claims = await defaultDependencies(dispatcher).claimNextPerChannel(
      new Date(),
      8
    );

    expect(claims).toHaveLength(1);
    expect(claims[0].command.id).toBe(other.command.id);
  });

  it("duas rodadas de lane preservam a ordem do canal (dispatch real)", async () => {
    const first = await createPair(refs.whatsappIdA);
    await new Promise(resolve => setTimeout(resolve, 10));
    const second = await createPair(refs.whatsappIdA);
    const other = await createPair(refs.whatsappIdB);

    const sendOrder: string[] = [];
    const dispatcher = new MessageCommandDispatcher(undefined, [
      {
        provider: "baileys",
        send: async (command: any) => {
          sendOrder.push(command.id);
          return { providerMessageId: "wamid_lane" };
        }
      } as any
    ]);

    await dispatcher.dispatchChannelLaneBatch(8);
    await dispatcher.dispatchChannelLaneBatch(8);

    // Dentro da rodada as lanes rodam em paralelo (ordem de término varia);
    // entre rodadas a ordem do canal A é estrita: first → second.
    expect(sendOrder.slice(0, 2).sort()).toEqual(
      [first.command.id, other.command.id].sort()
    );
    expect(sendOrder[2]).toBe(second.command.id);
  });
});

describe("lanes por canal — concorrência entre workers (banco real, T8)", () => {
  beforeEach(async () => {
    await MessagingOutboxEvent.destroy({ where: {}, force: true });
    await MessageCommand.destroy({ where: {}, force: true });
  });

  it("dois workers concorrentes nunca claimeiam o mesmo canal duas vezes", async () => {
    const first = await createPair(refs.whatsappIdA);
    await createPair(refs.whatsappIdA);
    await createPair(refs.whatsappIdA);

    const dispatcherA = new MessageCommandDispatcher(undefined, []);
    const dispatcherB = new MessageCommandDispatcher(undefined, []);
    const depsA = defaultDependencies(dispatcherA);
    const depsB = defaultDependencies(dispatcherB);

    const allClaims: Array<{ command: { id: string; whatsappId: number } }> =
      [];
    for (let round = 0; round < 5; round += 1) {
      // eslint-disable-next-line no-await-in-loop
      const [claimsA, claimsB] = await Promise.all([
        depsA.claimNextPerChannel(new Date(), 4),
        depsB.claimNextPerChannel(new Date(), 4)
      ]);
      const roundClaims = [...claimsA, ...claimsB];
      const channels = roundClaims.map(claim => claim.command.whatsappId);
      // Nunca dois claims do mesmo canal na mesma rodada concorrente.
      expect(new Set(channels).size).toBe(channels.length);
      allClaims.push(...roundClaims);
    }

    // O primeiro claim marca o comando como SENDING com lease vigente: todas
    // as rodadas seguintes são excluídas pela revalidação pós-lock.
    expect(allClaims).toHaveLength(1);
    expect(allClaims[0].command.id).toBe(first.command.id);
  });
});

afterAll(async () => {
  await sequelize.close();
});
