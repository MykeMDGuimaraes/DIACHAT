import * as Sentry from "@sentry/node";
import Whatsapp from "../../models/Whatsapp";
import { wbotMessageListener } from "./wbotMessageListener";
import { getIO } from "../../libs/socket";
import wbotMonitor from "./wbotMonitor";
import { logger } from "../../utils/logger";
import { getSessionManager } from "./WhatsAppSessionManager";
import type { Session } from "../../libs/wbot";

/**
 * INVENTARIO DE LISTENERS POR SOCKET (Task 2 do hardening)
 *
 * Todos os handlers por socket sao registrados UMA VEZ por sessao nova —
 * via hook onCreated do manager (abaixo) ou dentro de createWASocket — e
 * carregam a geracao capturada: handler de geracao substituida fica inerte
 * (fenceSessionListener / fenced) e o teardown do manager remove tudo com
 * ev.removeAllListeners().
 *
 * | Evento             | Registrado em                | Efeitos                        |
 * |--------------------|------------------------------|--------------------------------|
 * | connection.update  | createWASocket (wbot.ts)     | status/QR no banco, Socket.IO, |
 * |                    |                              | stopIfCurrent, reconnect (fenced) |
 * | creds.update       | createWASocket (wbot.ts)     | saveState (fenced)             |
 * | messages.upsert    | wbotMessageListener (aqui)   | tickets/mensagens (fenced)     |
 * | messages.update    | wbotMessageListener (aqui)   | ack/readMessages (fenced)      |
 * | CB:call (ws)       | wbotMonitor (aqui)           | resposta automatica (fenced)   |
 * | contacts.upsert    | wbotMonitor (aqui)           | sincroniza contatos (fenced)   |
 * | mirror lifecycle   | registerBaileysMirror...     | espelho de eventos do provedor |
 * |                    | (BaileysConnectionLifecycle) | (removido no teardown)         |
 */
interface StartSessionOptions {
  /** Re-pareamento: derruba a sessao vigente e sobe geracao nova. */
  replace?: boolean;
}

export const StartWhatsAppSession = async (
  whatsapp: Whatsapp,
  companyId: number,
  options: StartSessionOptions = {}
): Promise<void> => {
  await whatsapp.update({ status: "OPENING" });

  const io = getIO();
  io.to(`company-${whatsapp.companyId}-mainchannel`).emit("whatsappSession", {
    action: "update",
    session: whatsapp
  });

  try {
    // Toda entrada (boot, endpoint conectar, callback de reconexao) passa
    // pelo single-flight do SessionManager: no maximo uma tentativa e um
    // socket por canal. onCreated dispara uma unica vez por sessao nova —
    // starts reutilizados nunca duplicam listeners.
    const manager = getSessionManager();
    const startInput = {
      whatsapp,
      onCreated: (created: {
        whatsappId: number;
        generation: string;
        socket: unknown;
      }) => {
        const socket = created.socket as Session;
        wbotMessageListener(
          socket,
          companyId,
          created.whatsappId,
          created.generation
        );
        wbotMonitor(socket, whatsapp, companyId, created.generation);
      }
    };
    // store/boot/conectar => start (single-flight); re-parear => replace
    // (geracao nova, callbacks antigos inertes).
    if (options.replace) {
      await manager.replace(startInput);
    } else {
      await manager.start(startInput);
    }
  } catch (err) {
    Sentry.captureException(err);
    logger.error(err);
  }
};
