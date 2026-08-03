import { Op } from "sequelize";
import sequelize from "../../database";
import Message from "../../models/Message";
import {
  DELIVERY_CONFIRM_TIMEOUT_MS,
  MESSAGE_COMMAND_ERROR_CODE,
  MESSAGE_COMMAND_STATUS
} from "../domain/MessagingStates";
import MessageCommand from "../persistence/models/MessageCommand";
import MessagingOutboxEvent from "../persistence/models/MessagingOutboxEvent";
import { buildMessageUnknownEvent } from "./MessageCommandDispatcher";
import { logger } from "../../utils/logger";

const SWEEP_BATCH_SIZE = 50;

/**
 * Watchdog de confirmacao de entrega.
 *
 * O dispatcher marca o comando como `sent` quando o socket Baileys aceita a
 * mensagem, mas isso nao garante que o WhatsApp entregou — uma sessao
 * degradada pode derrubar o no de saida sem erro. Sem esta varredura, a
 * mensagem ficava "sent" para sempre mesmo sem ack.
 *
 * Regras para comandos `sent` mais velhos que DELIVERY_CONFIRM_TIMEOUT_MS:
 * - ack >= 4 na Message local => comando avanca para `read`;
 * - ack >= 3 => comando avanca para `delivered`;
 * - ack 2 (servidor do WhatsApp aceitou) => mantem `sent`;
 * - ack 0/1 => comando vira `unknown` com DELIVERY_UNCONFIRMED + evento
 *   publico de status, deixando de constar como enviado com sucesso.
 */
class DeliveryConfirmationRecoveryService {
  async recover(now = new Date()): Promise<{ recovered: number }> {
    const cutoff = new Date(now.getTime() - DELIVERY_CONFIRM_TIMEOUT_MS);
    const candidates = await MessageCommand.findAll({
      attributes: ["id"],
      where: {
        status: MESSAGE_COMMAND_STATUS.SENT,
        // completedAt nulo (dado legado/artificial) cai no updatedAt
        [Op.or]: [
          { completedAt: { [Op.lte]: cutoff } },
          { completedAt: null, updatedAt: { [Op.lte]: cutoff } }
        ]
      },
      order: [["completedAt", "ASC"]],
      limit: SWEEP_BATCH_SIZE
    });

    let recovered = 0;
    for (const candidate of candidates) {
      recovered += await this.reconcile(candidate.id, now);
    }
    return { recovered };
  }

  private async reconcile(commandId: string, now: Date): Promise<number> {
    return sequelize.transaction(async transaction => {
      const command = await MessageCommand.findOne({
        where: { id: commandId, status: MESSAGE_COMMAND_STATUS.SENT },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!command) return 0;

      // Lock na Message também: um ack concorrente grava nela, e sem o lock
      // o snapshot de ack podia ficar para trás e gerar falso "não confirmado".
      const message = command.messageId
        ? await Message.findOne({
            where: { id: command.messageId, companyId: command.companyId },
            transaction,
            lock: transaction.LOCK.UPDATE
          })
        : null;
      const ack = typeof message?.ack === "number" ? message.ack : 0;

      if (ack >= 4) {
        await command.update(
          { status: MESSAGE_COMMAND_STATUS.READ },
          { transaction }
        );
        return 1;
      }
      if (ack >= 3) {
        await command.update(
          { status: MESSAGE_COMMAND_STATUS.DELIVERED },
          { transaction }
        );
        return 1;
      }
      if (ack >= 2) {
        // ack 2 = o servidor do WhatsApp aceitou a mensagem: nao esta
        // perdida, apenas sem confirmacao do aparelho. Mantem "sent".
        return 0;
      }

      await command.update(
        {
          status: MESSAGE_COMMAND_STATUS.UNKNOWN,
          errorCode: MESSAGE_COMMAND_ERROR_CODE.DELIVERY_UNCONFIRMED
        },
        { transaction }
      );
      await MessagingOutboxEvent.create(
        buildMessageUnknownEvent(
          command.toJSON() as any,
          "sem confirmacao de entrega do WhatsApp (ack) dentro do prazo",
          MESSAGE_COMMAND_ERROR_CODE.DELIVERY_UNCONFIRMED
        ) as any,
        { transaction }
      );
      logger.warn(
        { commandId: command.id, messageId: command.messageId || null },
        "messaging: comando sem ack do WhatsApp; marcado como unknown (DELIVERY_UNCONFIRMED)"
      );
      return 1;
    });
  }
}

export default DeliveryConfirmationRecoveryService;
