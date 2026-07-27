import type { AnyMessageContent, MiscMessageGenerationOptions, WASocket } from "baileys";

type SendSocket = Pick<WASocket, "sendMessage">;

export const sendBaileysSocketMessage = (
  socket: SendSocket,
  jid: string,
  content: AnyMessageContent,
  options?: MiscMessageGenerationOptions
) => socket.sendMessage(jid, content, options);
