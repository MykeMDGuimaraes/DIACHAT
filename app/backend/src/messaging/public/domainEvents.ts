import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import BaileysDomainEventService, {
  extractSelectedButtonId
} from "../application/BaileysDomainEventService";

const service = new BaileysDomainEventService();

export const publishPersistedBaileysMessageEvents = (
  message: Message,
  ticket: Ticket,
  companyId: number
): Promise<void> => service.publish({ message, ticket, companyId });

export const publishBaileysConversationCreated = (
  ticket: Ticket,
  companyId: number
): Promise<void> => service.publishConversationCreated({ ticket, companyId });

export const persistBaileysConversationCreated = (
  ticket: Ticket,
  companyId: number,
  origin: "provider" | "api",
  transaction: any
): Promise<void> =>
  service.persistConversationCreated(
    {
      ticket,
      companyId,
      actorType: origin === "provider" ? "contact" : "system",
      origin
    },
    transaction
  );

export const publishBaileysMessageStatus = (
  companyId: number,
  messageId: string,
  ack: number | null | undefined
): Promise<void> => service.publishStatus({ companyId, messageId, ack });

export { extractSelectedButtonId };

export const acknowledgeBaileysProviderMessage = (
  companyId: number,
  providerMessageId: string,
  ack: number | null | undefined
) =>
  service.acknowledgeProviderMessage({
    companyId,
    providerMessageId,
    ack
  });

export const isBaileysApiProviderMessage = (
  companyId: number,
  providerMessageId: string
) => service.isApiProviderMessage(companyId, providerMessageId);
