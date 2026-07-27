import AppError from "../../errors/AppError";
import sequelize from "../../database";
import { createRequestFingerprint, validateIdempotencyKey } from "../domain/IdempotencyKey";
import MessageCommand from "../persistence/models/MessageCommand";
import MessagingOutboxEvent from "../persistence/models/MessagingOutboxEvent";

export interface CreateMessageCommandInput {
  companyId: number;
  whatsappId: number;
  provider: string;
  messageKind: string;
  recipient: string;
  idempotencyScope: string;
  idempotencyKey: string;
  requestPayload: Record<string, unknown>;
}

interface MessageCommandDependencies {
  transaction: <T>(callback: (transaction: any) => Promise<T>) => Promise<T>;
  findByIdempotencyKey: (
    input: CreateMessageCommandInput,
    transaction: any
  ) => Promise<any>;
  create: (data: Record<string, unknown>, transaction: any) => Promise<any>;
  createOutboxEvent: (
    data: Record<string, unknown>,
    transaction: any
  ) => Promise<any>;
}

const defaultDependencies: MessageCommandDependencies = {
  transaction: callback => sequelize.transaction(callback),
  findByIdempotencyKey: (input, transaction) =>
    MessageCommand.findOne({
      where: {
        companyId: input.companyId,
        idempotencyScope: input.idempotencyScope,
        idempotencyKey: input.idempotencyKey
      },
      transaction
    }),
  create: (data, transaction) => MessageCommand.create(data as any, { transaction }),
  createOutboxEvent: (data, transaction) =>
    MessagingOutboxEvent.create(data as any, { transaction })
};

class MessageCommandService {
  constructor(private readonly dependencies = defaultDependencies) {}

  fingerprint(input: CreateMessageCommandInput): string {
    return createRequestFingerprint({
      provider: input.provider,
      messageKind: input.messageKind,
      recipient: input.recipient,
      requestPayload: input.requestPayload
    });
  }

  async create(input: CreateMessageCommandInput): Promise<{
    command: any;
    replayed: boolean;
  }> {
    const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
    const normalizedInput = { ...input, idempotencyKey };
    const requestFingerprint = this.fingerprint(normalizedInput);

    return this.dependencies.transaction(async transaction => {
      const existing = await this.dependencies.findByIdempotencyKey(
        normalizedInput,
        transaction
      );

      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) {
          throw new AppError("IDEMPOTENCY_CONFLICT", 409);
        }

        return { command: existing, replayed: true };
      }

      const command = await this.dependencies.create(
        {
          ...normalizedInput,
          requestFingerprint,
          status: "queued",
          attemptCount: 0
        },
        transaction
      );

      await this.dependencies.createOutboxEvent(
        {
          companyId: normalizedInput.companyId,
          eventType: "message.dispatch.requested",
          aggregateId: command.id,
          payload: { commandId: command.id },
          status: "ready",
          attemptCount: 0
        },
        transaction
      );

      return { command, replayed: false };
    });
  }
}

export default MessageCommandService;
