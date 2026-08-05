import type {
  AnyMessageContent,
  MiscMessageGenerationOptions,
  WASocket
} from "baileys";

type SendSocket = Pick<WASocket, "sendMessage">;

export const sendBaileysSocketMessage = (
  socket: SendSocket,
  jid: string,
  content: AnyMessageContent,
  options?: MiscMessageGenerationOptions
) => socket.sendMessage(jid, content, options);

interface DeleteKey {
  id: string;
  remoteJid: string;
  participant?: string | null;
  fromMe: boolean;
}

/**
 * Revogacao de mensagem (operacao de protocolo, NAO uma mensagem de
 * usuario): unico uso legitimo do socket direto fora do adapter. O
 * conteudo nao passa pelo outbox porque nao ha mensagem a entregar.
 */
export const deleteBaileysMessage = (
  socket: SendSocket,
  remoteJid: string,
  key: DeleteKey
) => sendBaileysSocketMessage(socket, remoteJid, { delete: key });
