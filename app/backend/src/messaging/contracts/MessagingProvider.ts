export interface DispatchableMessageCommand {
  id: string;
  companyId: number;
  whatsappId: number;
  provider: string;
  messageKind: string;
  recipient: string;
  requestPayload: Record<string, unknown>;
}

export interface MessagingProvider {
  provider: string;
  send(command: DispatchableMessageCommand): Promise<{
    providerMessageId?: string;
  }>;
}
