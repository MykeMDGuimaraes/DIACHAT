import { Op } from "sequelize";
import Message from "../../models/Message";
import MessageCommand from "../persistence/models/MessageCommand";

/**
 * Projeção aditiva de entrega (Hardening T5): expõe o estado do comando do
 * outbox junto à mensagem no GET /messages e nos eventos de socket, sem
 * quebrar consumidores existentes (campo novo, nunca altera os atuais).
 */
export interface DeliveryProjection {
  status: string;
  errorCode: string | null;
  updatedAt: Date | string | null;
}

export const attachDeliveryProjection = async (
  companyId: number,
  messages: Message | Message[]
): Promise<void> => {
  const list = (Array.isArray(messages) ? messages : [messages]).filter(
    Boolean
  );
  const ids = list
    .map(message => String(message.id))
    .filter(id => id && id !== "undefined");
  if (!ids.length) return;

  const commands = await MessageCommand.findAll({
    attributes: ["messageId", "status", "errorCode", "updatedAt"],
    where: { companyId, messageId: { [Op.in]: ids } }
  });
  const byMessageId = new Map(
    commands.map(command => [String(command.messageId), command])
  );

  for (const message of list) {
    const command = byMessageId.get(String(message.id));
    if (command) {
      // Campo virtual (não é coluna do modelo): projeção aditiva, só na saída.
      (message as any).setDataValue("delivery", {
        status: command.status,
        errorCode: command.errorCode || null,
        updatedAt: command.updatedAt || null
      } as DeliveryProjection);
    }
  }
};
