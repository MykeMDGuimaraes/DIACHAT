import { Op } from "sequelize";

import AppError from "../../errors/AppError";
import MessageCommand from "../persistence/models/MessageCommand";
import ConversationAutomationState from "../persistence/models/ConversationAutomationState";

interface ReserveAutomatedMessageInput {
  companyId: number;
  conversationId: string;
  externalTicketId: string;
  automationEpoch: number;
  transaction: any;
}

interface ConversationAutomationDependencies {
  findState(
    companyId: number,
    externalTicketId: string,
    transaction: any
  ): Promise<any | null>;
  createState(data: Record<string, unknown>, transaction: any): Promise<any>;
  updateState(
    state: any,
    data: Record<string, unknown>,
    transaction: any
  ): Promise<any>;
  cancelOlderMessages(
    companyId: number,
    externalTicketId: string,
    automationEpoch: number,
    transaction: any
  ): Promise<unknown>;
}

const defaultDependencies: ConversationAutomationDependencies = {
  findState: (companyId, externalTicketId, transaction) =>
    ConversationAutomationState.findOne({
      where: { companyId, externalTicketId },
      transaction,
      lock: transaction.LOCK.UPDATE
    }),
  createState: (data, transaction) =>
    ConversationAutomationState.create(data as any, { transaction }),
  updateState: (state, data, transaction) =>
    state.update(data, { transaction }),
  cancelOlderMessages: (
    companyId,
    externalTicketId,
    automationEpoch,
    transaction
  ) =>
    MessageCommand.update(
      {
        status: "cancelled",
        errorCode: "STALE_AUTOMATION_EPOCH",
        completedAt: new Date()
      },
      {
        where: {
          companyId,
          externalTicketId,
          automationEpoch: { [Op.lt]: automationEpoch },
          status: "queued"
        },
        transaction
      }
    )
};

class ConversationAutomationService {
  // Parameter property keeps the transactional repository replaceable in tests.
  // eslint-disable-next-line no-useless-constructor
  constructor(
    private readonly dependencies: ConversationAutomationDependencies = defaultDependencies
  ) {}

  async reserveAutomatedMessage(
    input: ReserveAutomatedMessageInput
  ): Promise<any> {
    const state = await this.dependencies.findState(
      input.companyId,
      input.externalTicketId,
      input.transaction
    );
    if (!state) {
      try {
        return await this.dependencies.createState(
          {
            companyId: input.companyId,
            conversationId: input.conversationId,
            externalTicketId: input.externalTicketId,
            automationEpoch: input.automationEpoch,
            state: "automation"
          },
          input.transaction
        );
      } catch (error: any) {
        if (
          error?.name === "SequelizeUniqueConstraintError" ||
          error?.original?.code === "23505"
        ) {
          throw new AppError("CONVERSATION_STATE_CONFLICT", 409);
        }
        throw error;
      }
    }
    if (
      input.automationEpoch < state.automationEpoch ||
      state.state !== "automation"
    ) {
      throw new AppError("STALE_AUTOMATION_EPOCH", 409);
    }
    if (input.automationEpoch === state.automationEpoch) {
      if (state.conversationId !== input.conversationId) {
        throw new AppError("CONVERSATION_CORRELATION_CONFLICT", 409);
      }
      return state;
    }

    const updated = await this.dependencies.updateState(
      state,
      {
        automationEpoch: input.automationEpoch,
        conversationId: input.conversationId
      },
      input.transaction
    );
    await this.dependencies.cancelOlderMessages(
      input.companyId,
      input.externalTicketId,
      input.automationEpoch,
      input.transaction
    );
    return updated;
  }
}

export default ConversationAutomationService;
