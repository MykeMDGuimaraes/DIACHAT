export type MessageCommandStatus =
  | "queued"
  | "persisted"
  | "sending"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "unknown";

export type MessageCommandErrorCode = "SEND_OUTCOME_UNKNOWN";

export interface MessageCommandState {
  id: string;
  status: MessageCommandStatus;
  leaseExpiresAt?: Date;
  errorCode?: MessageCommandErrorCode;
}

export const recoverExpiredSendingCommand = (
  command: MessageCommandState,
  now: Date
): MessageCommandState => {
  if (
    command.status !== "sending" ||
    !command.leaseExpiresAt ||
    command.leaseExpiresAt > now
  ) {
    return command;
  }

  return {
    ...command,
    status: "unknown",
    errorCode: "SEND_OUTCOME_UNKNOWN",
    leaseExpiresAt: undefined
  };
};
