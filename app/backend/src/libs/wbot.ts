import * as Sentry from "@sentry/node";

import { randomUUID } from "crypto";
import { Boom } from "@hapi/boom";
import NodeCache from "node-cache";
import makeWASocket, {
  WASocket,
  Browsers,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  // makeInMemoryStore,
  isJidBroadcast,
  CacheStore
} from "../messaging/public/baileys";
import Whatsapp from "../models/Whatsapp";
import { logger } from "../utils/logger";
import { BaileysLogger as MAIN_LOGGER } from "../messaging/public/baileys";
import authState from "../helpers/authState";
import AppError from "../errors/AppError";
import { getIO } from "./socket";
import { Store } from "./store";
import { StartWhatsAppSession } from "../services/WbotServices/StartWhatsAppSession";
import DeleteBaileysService from "../services/BaileysServices/DeleteBaileysService";
import waitForSessionReady, {
  DEFAULT_RECONNECT_WAIT_MS
} from "./waitForSessionReady";
import { registerBaileysConnectionLifecycle } from "../services/WbotServices/BaileysConnectionLifecycle";
import { decideDisconnect } from "../services/WbotServices/BaileysDisconnectPolicy";
import {
  configureSessionManager,
  getSessionManager
} from "../services/WbotServices/WhatsAppSessionManager";

const loggerBaileys = MAIN_LOGGER.child({});
loggerBaileys.level = "error";

export type Session = WASocket & {
  id?: number;
  store?: Store;
};

// Array legado de sockets: leituras passaram a delegar ao SessionManager
// (Task 1 do hardening); o array so permanece ate a migracao completa dos
// listeners e callers na Task 2. Toda remocao e por identidade de socket,
// nunca so por ID — ver wbotLegacySessions.
import {
  getLegacySession,
  removeLegacySessionIfCurrent,
  trackLegacySession
} from "./wbotLegacySessions";

export { getWbotSessionIds } from "./wbotLegacySessions";

export const getWbot = (whatsappId: number): Session => {
  const managed = getSessionManager().getActiveIfPresent(whatsappId);
  if (managed) return managed.socket as Session;

  const legacy = getLegacySession<Session>(whatsappId);
  if (!legacy) {
    throw new AppError("ERR_WAPP_NOT_INITIALIZED");
  }
  return legacy;
};

const findReadySession = (whatsappId: number): Session | undefined => {
  const managed = getSessionManager().getActiveIfPresent(whatsappId);
  if (managed && managed.socket.user) {
    return managed.socket as Session;
  }
  const legacy = getLegacySession<Session>(whatsappId);
  // A session is only usable for sending after Baileys authenticates it
  // ("open" connection populates `user`). Sessions registered while showing
  // a QR code are not ready.
  if (legacy && legacy.user) return legacy;
  return undefined;
};

/**
 * Returns the session for a WhatsApp connection, waiting (up to `timeoutMs`)
 * for it to come back if the socket is currently reconnecting — e.g. after a
 * Baileys stream error 515. Throws ERR_WAPP_NOT_AVAILABLE (503) if the
 * connection does not recover within the window.
 */
export const waitForWbot = async (
  whatsappId: number,
  timeoutMs = DEFAULT_RECONNECT_WAIT_MS
): Promise<Session> =>
  waitForSessionReady(() => findReadySession(whatsappId), timeoutMs);

export const removeWbot = async (
  whatsappId: number,
  isLogout = true
): Promise<void> => {
  // Captura ANTES do stop os sockets que esta chamada deve encerrar: entre o
  // stop e a limpeza, uma start concorrente pode registrar um socket novo no
  // canal — ele nao pode ser tocado por esta remocao.
  const managedSocket = getSessionManager().getActiveIfPresent(whatsappId)
    ?.socket as Session | undefined;
  const legacySocket = getLegacySession<Session>(whatsappId);
  const targetSocket = managedSocket ?? legacySocket;

  try {
    // O SessionManager e o proprietario do socket: teardown, heartbeat e
    // liberacao da lease acontecem aqui.
    await getSessionManager().stop(
      whatsappId,
      isLogout ? "logout" : "close"
    );
  } catch (err) {
    logger.error(err);
  }

  try {
    if (!managedSocket && legacySocket && isLogout) {
      // Socket que o manager nao conhece: logout/close locais.
      legacySocket.logout();
      legacySocket.ws.close();
    }
    // Remove a entrada legada SOMENTE se ela ainda for o socket capturado;
    // uma geracao nova registrada no meio-tempo e preservada.
    if (targetSocket) {
      removeLegacySessionIfCurrent(whatsappId, targetSocket);
    }
  } catch (err) {
    logger.error(err);
  }
};

/**
 * Cria o socket Baileys e registra o callback de conexao. Retorna o socket
 * ainda em "opening" (QR/pareamento) — e a factory injetada no
 * SessionManager, que passa a ser o proprietario do ciclo de vida.
 */
export const createWASocket = async (
  whatsapp: Whatsapp,
  generation?: string
): Promise<Session> => {
  const io = getIO();

  const whatsappUpdate = await Whatsapp.findOne({
    where: { id: whatsapp.id }
  });

  if (!whatsappUpdate) {
    throw new AppError("ERR_WAPP_NOT_INITIALIZED");
  }

  const { id, name, provider } = whatsappUpdate;

  const { version, isLatest } = await fetchLatestBaileysVersion();
  const isLegacy = provider === "stable";

  logger.info(`using WA v${version.join(".")}, isLatest: ${isLatest}`);
  logger.info(`isLegacy: ${isLegacy}`);
  logger.info(`Starting session ${name}`);

  const { state, saveState } = await authState(whatsapp);

  const msgRetryCounterCache = new NodeCache();

  const wsocket: Session = makeWASocket({
    logger: loggerBaileys,
    printQRInTerminal: false,
    browser: Browsers.appropriate("Desktop"),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    version,
    msgRetryCounterCache,
    shouldIgnoreJid: jid => isJidBroadcast(jid)
  });

  // Efeitos persistentes do lifecycle (banco, emits, stop, reconexao) so
  // executam se a geracao do socket ainda for a vigente: callbacks de
  // sessoes substituidas ficam inertes. Sem geracao (chamador legado via
  // initWASocket) os efeitos executam direto, como antes.
  const fenced = async (effect: () => Promise<void> | void): Promise<void> => {
    if (!generation) {
      await effect();
      return;
    }
    await getSessionManager().runFenced(id, generation, effect);
  };

  // Revalidacao nas fronteiras assincronas: entre um await e outro um
  // replace pode ter publicado uma geracao nova.
  const stillCurrent = (): boolean =>
    !generation || getSessionManager().isCurrent(id, generation);

  registerBaileysConnectionLifecycle(
    wsocket,
    {
      companyId: whatsapp.companyId,
      whatsappId: id
    },
    async ({ connection, lastDisconnect, qr }) => {
      logger.info(
        `Socket  ${name} Connection Update ${connection || ""} ${
          lastDisconnect || ""
        }`
      );

      // O log acima serializa o erro como "[object Object]". Registrar o
      // codigo de desconexao de forma estruturada: 401/403/428/515
      // indicam logout ou restricao no lado do WhatsApp. Nao logar
      // `data`/`payload` brutos: sao conteudo do protocolo vindo do
      // servidor, sem formato garantido e potencialmente sensiveis.
      if (lastDisconnect?.error) {
        const disconnectErr = lastDisconnect.error as Boom;
        logger.warn(
          {
            whatsappId: id,
            connection: connection || null,
            statusCode: disconnectErr?.output?.statusCode || null,
            message: disconnectErr?.message || null
          },
          "wbot: conexao fechada com erro do WhatsApp"
        );
      }

      if (connection === "close") {
        // Politica centralizada: decide acao, destino da credencial e teto
        // de reconexao para o statusCode do WhatsApp.
        const statusCode = (lastDisconnect?.error as Boom)?.output
          ?.statusCode;
        const decision = decideDisconnect(statusCode);
        logger.warn(
          {
            whatsappId: id,
            statusCode: statusCode ?? null,
            reasonCode: decision.reasonCode,
            action: decision.action,
            clearCredential: decision.clearCredential
          },
          "wbot: decisao da politica de desconexao"
        );

        await fenced(async () => {
          const manager = getSessionManager();
          // Revalida antes de mexer na credencial: um 401/403 de geracao
          // antiga nao pode apagar o pareamento da sessao nova.
          if (decision.clearCredential && stillCurrent()) {
            await whatsapp.update({ status: "PENDING", session: "" });
            await DeleteBaileysService(whatsapp.id);
            io.to(`company-${whatsapp.companyId}-mainchannel`).emit(
              `company-${whatsapp.companyId}-whatsappSession`,
              {
                action: "update",
                session: whatsapp
              }
            );
          }
          // Stop condicional a ESTA geracao: se um replace publicou outra
          // sessao enquanto este callback aguardava, nada e derrubado e
          // nenhuma reconexao e agendada.
          const stopped = generation
            ? await manager.stopIfCurrent(id, generation, "close")
            : await removeWbot(id, false).then(() => true);
          if (stopped && decision.action === "reconnect") {
            // Reconexao com teto da policy, agendada so pelo manager:
            // replace/stop cancelam este timer junto com a geracao.
            manager.tryScheduleReconnect(
              id,
              2000,
              decision.maxReconnectAttempts,
              () => {
                void StartWhatsAppSession(whatsapp, whatsapp.companyId);
              }
            );
          }
          if (stopped) removeLegacySessionIfCurrent(id, wsocket);
        });
      }

      if (connection === "open") {
        await fenced(async () => {
          await whatsapp.update({
            status: "CONNECTED",
            qrcode: "",
            retries: 0
          });
          // Sessao autenticada: o teto de reconexoes volta a contar do zero.
          getSessionManager().resetReconnectAttempts(id);

          io.to(`company-${whatsapp.companyId}-mainchannel`).emit(
            `company-${whatsapp.companyId}-whatsappSession`,
            {
              action: "update",
              session: whatsapp
            }
          );

          trackLegacySession(whatsapp.id, wsocket);
        });
      }

      if (qr !== undefined) {
        const sessionManager = getSessionManager();
        await fenced(async () => {
          if (sessionManager.getQrRetries(id) >= 3) {
            await whatsappUpdate.update({
              status: "DISCONNECTED",
              qrcode: ""
            });
            await DeleteBaileysService(whatsappUpdate.id);
            io.to(`company-${whatsapp.companyId}-mainchannel`).emit(
              "whatsappSession",
              {
                action: "update",
                session: whatsappUpdate
              }
            );
            sessionManager.resetQrRetries(id);
            // O manager e o proprietario do socket: teardown e liberacao da
            // lease acontecem no stop condicional a esta geracao.
            const stopped = generation
              ? await sessionManager.stopIfCurrent(id, generation, "close")
              : await removeWbot(id, false).then(() => true);
            if (stopped) removeLegacySessionIfCurrent(id, wsocket);
          } else {
            logger.info(`Session QRCode Generate ${name}`);
            sessionManager.incrementQrRetries(id);

            await whatsapp.update({
              qrcode: qr,
              status: "qrcode",
              retries: 0
            });

            trackLegacySession(whatsapp.id, wsocket);

            io.to(`company-${whatsapp.companyId}-mainchannel`).emit(
              `company-${whatsapp.companyId}-whatsappSession`,
              {
                action: "update",
                session: whatsapp
              }
            );
          }
        });
      }
    }
  );
  wsocket.ev.on("creds.update", saveState);

  return wsocket;
};

// O SessionManager e configurado uma unica vez por processo: ownerId
// identifica esta replica na lease PostgreSQL do canal.
configureSessionManager({
  ownerId: process.env.WAPP_SESSION_OWNER_ID || randomUUID(),
  socketFactory: input =>
    createWASocket(input.whatsapp as Whatsapp, input.generation),
  // Rearme gerenciado: so dispara em perda transitoria da lease (banco
  // indisponivel); takeover por outro owner nunca rearma.
  onSessionEnded: whatsappId => {
    Whatsapp.findByPk(whatsappId)
      .then(whatsappModel => {
        if (whatsappModel) {
          void StartWhatsAppSession(whatsappModel, whatsappModel.companyId);
        }
      })
      .catch(err => logger.error(err));
  }
});

/**
 * Comportamento historico: resolve somente quando a conexao abre. Chamadores
 * novos devem preferir o SessionManager (start/getReady), que devolve o
 * socket ja em "opening" para heartbeat durante QR/pareamento.
 */
export const initWASocket = async (whatsapp: Whatsapp): Promise<Session> => {
  const wsocket = await createWASocket(whatsapp);
  if (wsocket.user) return wsocket;
  return new Promise(resolve => {
    let resolved = false;
    wsocket.ev.on("connection.update", (update: { connection?: string }) => {
      if (!resolved && update.connection === "open") {
        resolved = true;
        resolve(wsocket);
      }
    });
  });
};
