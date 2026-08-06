import { randomUUID } from "crypto";
import { Boom } from "@hapi/boom";
import makeWASocket, {
  WASocket,
  Browsers,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  // makeInMemoryStore,
  isJidBroadcast,
  BaileysLogger as MAIN_LOGGER
} from "../messaging/public/baileys";
import Whatsapp from "../models/Whatsapp";
import { logger } from "../utils/logger";
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
import { handleAuthWritePersistentFailure } from "../services/WbotServices/authWriteFailurePolicy";
import {
  configureSessionManager,
  getSessionManager
} from "../services/WbotServices/WhatsAppSessionManager";
import {
  DELIVERY_ALERT,
  DELIVERY_METRIC,
  STREAM_REPLACEMENT_STATUS_CODES,
  emitDeliveryAlert,
  incrementDeliveryCounter
} from "../messaging/public/observability";
import { createMsgRetryCounterCache } from "./baileysRetryCounterCache";

const loggerBaileys = MAIN_LOGGER.child({});
loggerBaileys.level = "error";

export type Session = WASocket & {
  id?: number;
  store?: Store;
};

// O SessionManager e o unico dono do ciclo de vida dos sockets (Task 2 do
// hardening): nao existe mais array legado — todas as leituras delegam a ele.
export const getWbotSessionIds = (): number[] =>
  getSessionManager().listActiveSessionIds();

export const getWbot = (whatsappId: number): Session => {
  const managed = getSessionManager().getActiveIfPresent(whatsappId);
  if (!managed) {
    throw new AppError("ERR_WAPP_NOT_INITIALIZED");
  }
  return managed.socket as Session;
};

const findReadySession = (whatsappId: number): Session | undefined => {
  const managed = getSessionManager().getActiveIfPresent(whatsappId);
  // A session is only usable for sending after Baileys authenticates it
  // ("open" connection populates `user`). Sessions registered while showing
  // a QR code are not ready.
  if (managed && managed.socket.user) {
    return managed.socket as Session;
  }
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

/**
 * Cria o socket Baileys e registra o callback de conexao. Retorna o socket
 * ainda em "opening" (QR/pareamento) — e a factory injetada no
 * SessionManager, proprietario do ciclo de vida.
 *
 * A geracao e obrigatoria: todo efeito persistente do lifecycle (banco,
 * emits, stop, reconexao, saveState) so executa se a geracao do socket
 * ainda for a vigente; callbacks de sessoes substituidas ficam inertes.
 */
export const createWASocket = async (
  whatsapp: Whatsapp,
  generation: string
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

  // Persistencia de auth-state guardada pela geracao: vale para creds.update
  // E para o keys.set interno do Baileys — um socket substituido nao grava
  // mais nada (ver authState). As escritas passam pela fila serializada do
  // canal (Task 3); falhas repetidas de escrita obrigatoria encerram e
  // sinalizam a sessao preservando o ultimo snapshot valido — a politica
  // reavalia o fence antes de qualquer efeito (authWriteFailurePolicy).
  const { state, saveState } = await authState(whatsapp, {
    shouldPersist: () => getSessionManager().isCurrent(id, generation),
    onPersistentFailure: () =>
      handleAuthWritePersistentFailure({
        whatsapp,
        generation,
        emit: (room, event, payload) => io.to(room).emit(event, payload)
      })
  });

  // Cache de retry limitado (T8): TTL + tamanho máximo; criado por socket,
  // então substituir a geração descarta o cache inteiro junto com o socket.
  const msgRetryCounterCache = createMsgRetryCounterCache();

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
  // Identidade do canal no proprio socket: handlers de mensagem e monitor
  // usam wbot.id para tickets, contatos e logs.
  wsocket.id = id;

  // Efeitos persistentes do lifecycle (banco, emits, stop, reconexao) so
  // executam se a geracao do socket ainda for a vigente: callbacks de
  // sessoes substituidas ficam inertes.
  const fenced = async (effect: () => Promise<void> | void): Promise<void> => {
    await getSessionManager().runFenced(id, generation, effect);
  };

  // Revalidacao nas fronteiras assincronas: entre um await e outro um
  // replace pode ter publicado uma geracao nova.
  const stillCurrent = (): boolean =>
    getSessionManager().isCurrent(id, generation);

  // Fence dos listeners do mirror (connection.update/messages.*): callbacks
  // de geracao substituida nao publicam eventos do provedor. O 4o arg fica
  // undefined para manter o registerMirror padrao.
  const fenceMirrorListener =
    (handler: (value: any) => Promise<void>) => (value: any) =>
      fenced(() => handler(value));

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
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
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

        // Alertas (T7): sessao terminal e substituicao de stream (440/463)
        // sao avisos operacionais — investigar, nao agir automaticamente.
        if (decision.disconnectClass === "terminal") {
          emitDeliveryAlert("warning", DELIVERY_ALERT.TERMINAL_SESSION, {
            whatsappId: id,
            companyId: whatsapp.companyId,
            statusCode: statusCode ?? null,
            reasonCode: decision.reasonCode
          });
        }
        if (
          typeof statusCode === "number" &&
          STREAM_REPLACEMENT_STATUS_CODES.includes(statusCode)
        ) {
          emitDeliveryAlert(
            "warning",
            DELIVERY_ALERT.STREAM_REPLACEMENT_WARNING,
            {
              whatsappId: id,
              companyId: whatsapp.companyId,
              statusCode,
              reasonCode: decision.reasonCode
            }
          );
        }

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
          const stopped = await manager.stopIfCurrent(id, generation, "close");
          if (stopped && decision.action === "reconnect") {
            // Reconexao por reasonCode normalizado (T7).
            incrementDeliveryCounter(DELIVERY_METRIC.RECONNECT_TOTAL, {
              whatsappId: id,
              companyId: whatsapp.companyId,
              reasonCode: decision.reasonCode
            });
            // Reconexao com teto da policy, agendada so pelo manager:
            // replace/stop cancelam este timer junto com a geracao.
            manager.tryScheduleReconnect(
              id,
              2000,
              decision.maxReconnectAttempts,
              () => {
                StartWhatsAppSession(whatsapp, whatsapp.companyId).catch(err =>
                  logger.error(err)
                );
              }
            );
          }
        });
      }

      if (connection === "open") {
        await fenced(async () => {
          // "open" publica CONNECTED como estado da conexao Baileys — NAO
          // declara entrega saudavel (confirmacao de entrega e Task 5).
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
            await sessionManager.stopIfCurrent(id, generation, "close");
          } else {
            logger.info(`Session QRCode Generate ${name}`);
            sessionManager.incrementQrRetries(id);

            await whatsapp.update({
              qrcode: qr,
              status: "qrcode",
              retries: 0
            });

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
    },
    undefined,
    fenceMirrorListener
  );
  // Persistencia de credenciais fenced: um creds.update de geracao vencida
  // nao sobrescreve o pareamento da sessao nova. A escrita aguarda a fila
  // do canal (Task 3); a fila ja loga falhas de forma estruturada, entao o
  // catch aqui apenas evita rejeicao nao tratada no emitter do Baileys.
  wsocket.ev.on("creds.update", () =>
    fenced(() => saveState().catch(() => undefined))
  );

  return wsocket;
};

// O SessionManager e configurado uma unica vez por processo: ownerId
// identifica esta replica na lease PostgreSQL do canal.
configureSessionManager({
  ownerId: process.env.WAPP_SESSION_OWNER_ID || randomUUID(),
  socketFactory: input =>
    createWASocket(input.whatsapp as Whatsapp, input.generation as string),
  // Rearme gerenciado: so dispara em perda transitoria da lease (banco
  // indisponivel); takeover por outro owner nunca rearma.
  onSessionEnded: whatsappId => {
    Whatsapp.findByPk(whatsappId)
      .then(whatsappModel => {
        if (whatsappModel) {
          StartWhatsAppSession(whatsappModel, whatsappModel.companyId).catch(
            err => logger.error(err)
          );
        }
      })
      .catch(err => logger.error(err));
  }
});
