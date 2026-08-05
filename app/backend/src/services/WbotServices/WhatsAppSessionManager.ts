import AppError from "../../errors/AppError";
import { logger } from "../../utils/logger";
import waitForSessionReady, {
  DEFAULT_RECONNECT_WAIT_MS
} from "../../libs/waitForSessionReady";
import {
  acquireSessionLease,
  renewSessionLease,
  releaseSessionLease
} from "../../messaging/public/sessionLeases";

/**
 * SessionManager single-flight (Task 1 do hardening de entrega WhatsApp).
 *
 * E o unico proprietario local do socket Baileys de cada canal: no maximo um
 * socket ativo e uma tentativa de conexao em andamento por whatsappId no
 * processo. Uma lease PostgreSQL com fencing token (via fachada
 * messaging/public/sessionLeases) garante a mesma exclusividade entre
 * processos/replicas; perder a lease fecha o socket imediatamente e falhar na
 * aquisicao impede qualquer socket de abrir (falha fechado).
 *
 * start/replace/stop sao serializados por canal (fila interna): um stop
 * durante um start aguarda a tentativa concluir e derruba a sessao publicada;
 * um replace nunca coexisti com outra tentativa. Todo efeito persistente de
 * lifecycle deve validar a geracao vigente (isCurrent/runFenced): callbacks
 * de geracoes substituidas ficam inertes.
 */

export const LEASE_TTL_MS = 30000;
export const HEARTBEAT_INTERVAL_MS = 10000;
export const MAX_RENEWAL_FAILURES = 2;
export const LEASE_LOSS_RECONNECT_DELAY_MS = 5000;

/** Forma minima de um socket Baileys para o manager (evita importar o vendor). */
export interface ManagedSocket {
  user?: unknown;
  ev: {
    on?(event: string, handler: (value: any) => unknown): unknown;
    removeAllListeners(event?: string): unknown;
  };
  ws: {
    close(): unknown;
  };
  logout?(): Promise<void> | void;
}

export interface WhatsappRef {
  id: number;
  companyId: number;
}

export interface ManagedSession {
  whatsappId: number;
  companyId: number;
  /** Mesmo valor do fencingToken persistido na lease. */
  generation: string;
  socket: ManagedSocket;
  openedAt?: Date;
  closing: boolean;
}

export interface StartSessionInput {
  whatsapp: WhatsappRef;
  /**
   * Preenchido pelo manager antes de invocar a factory: a geracao (fencing
   * token) que os callbacks do socket devem validar antes de qualquer efeito
   * persistente.
   */
  generation?: string;
  /** Chamado uma unica vez, somente quando a start publica uma sessao nova. */
  onCreated?: (session: ManagedSession) => void;
}

export type SessionStartReason = "manual" | "reconnect" | "replace";

export type SessionSocketFactory = (
  input: StartSessionInput
) => Promise<ManagedSocket>;

export type SessionStopMode = "close" | "logout";

export interface SessionDiagnostics {
  whatsappId: number;
  hasActiveSession: boolean;
  generation: string | null;
  inFlight: boolean;
  reconnectScheduled: boolean;
  qrRetries: number;
  renewalFailures: number;
  reconnectAttempts: number;
  /** Metrica diagnostica do processo; em operacao normal e 0 ou 1. */
  activeSocketCount: number;
}

export interface SessionManagerDeps {
  ownerId: string;
  socketFactory: SessionSocketFactory;
  /**
   * Chamado quando a sessao morre por falhas transitorias de renovacao da
   * lease (banco indisponivel): o processo ainda e o dono provavel, entao o
   * canal pode ser rearmado. Takeover definitivo (renew=false) NAO dispara
   * este hook — outro owner assumiu e reconectar viraria loop de takeover.
   */
  onSessionEnded?: (whatsappId: number) => void;
  heartbeatIntervalMs?: number;
  leaseTtlMs?: number;
  maxRenewalFailures?: number;
}

export class WhatsAppSessionManager {
  private readonly ownerId: string;

  private readonly socketFactory: SessionSocketFactory;

  private readonly onSessionEnded?: (whatsappId: number) => void;

  private readonly heartbeatIntervalMs: number;

  private readonly leaseTtlMs: number;

  private readonly maxRenewalFailures: number;

  private readonly activeSessions = new Map<number, ManagedSession>();

  private readonly inFlightConnections = new Map<
    number,
    Promise<ManagedSession>
  >();

  /** Fila serial de operacoes de lifecycle (start/replace/stop) por canal. */
  private readonly channelOps = new Map<number, Promise<unknown>>();

  private readonly reconnectTimers = new Map<number, NodeJS.Timeout>();

  // Tentativas consecutivas de reconexao por canal (teto da policy); zera
  // somente no open da sessao ou em stop manual.
  private readonly reconnectAttempts = new Map<number, number>();

  // Absorve o retriesQrCodeMap que vivia solto em wbot.ts.
  private readonly qrRetryCounters = new Map<number, number>();

  private readonly heartbeatTimers = new Map<number, NodeJS.Timeout>();

  private readonly heartbeatRunning = new Set<number>();

  private readonly renewalFailures = new Map<number, number>();

  constructor({
    ownerId,
    socketFactory,
    onSessionEnded,
    heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS,
    leaseTtlMs = LEASE_TTL_MS,
    maxRenewalFailures = MAX_RENEWAL_FAILURES
  }: SessionManagerDeps) {
    this.ownerId = ownerId;
    this.socketFactory = socketFactory;
    this.onSessionEnded = onSessionEnded;
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.leaseTtlMs = leaseTtlMs;
    this.maxRenewalFailures = maxRenewalFailures;
  }

  /**
   * Single-flight: retorna a sessao ativa, a mesma Promise de uma tentativa
   * em andamento, ou enfileira uma nova tentativa com lease propria.
   */
  async start(input: StartSessionInput): Promise<ManagedSession> {
    const { id } = input.whatsapp;

    const active = this.activeSessions.get(id);
    if (active && !active.closing) return active;

    const inFlight = this.inFlightConnections.get(id);
    if (inFlight) return inFlight;

    const attempt = this.enqueue(id, () => this.acquireAndStart(input));
    this.inFlightConnections.set(id, attempt);
    try {
      return await attempt;
    } finally {
      if (this.inFlightConnections.get(id) === attempt) {
        this.inFlightConnections.delete(id);
      }
    }
  }

  /**
   * Substitui a sessao vigente: cancela reconexao agendada, derruba a sessao
   * anterior (listeners removidos e socket fechado) e so entao publica a
   * proxima geracao — com fencing token novo, invalidando callbacks antigos.
   * Serializada com start/stop: nunca coexistem duas tentativas no canal.
   */
  async replace(
    input: StartSessionInput,
    reason: SessionStartReason = "replace"
  ): Promise<ManagedSession> {
    const { id } = input.whatsapp;
    logger.info(
      { whatsappId: id, reason },
      "session-manager: substituindo sessao do canal"
    );
    this.cancelReconnect(id);
    // Marca sincronamente a sessao condenada: um start() concorrente nao a
    // devolve enquanto o teardown aguarda na fila.
    const condemned = this.activeSessions.get(id);
    if (condemned) condemned.closing = true;

    const attempt = this.enqueue(id, async () => {
      const previous = this.activeSessions.get(id);
      if (previous) {
        await this.teardownSession(previous);
      }
      return this.acquireAndStart(input);
    });
    this.inFlightConnections.set(id, attempt);
    try {
      return await attempt;
    } finally {
      if (this.inFlightConnections.get(id) === attempt) {
        this.inFlightConnections.delete(id);
      }
    }
  }

  /**
   * Encerramento serializado: aguarda qualquer tentativa em andamento
   * concluir e derruba a sessao publicada. Nenhum socket sobrevive a um stop.
   */
  async stop(whatsappId: number, mode: SessionStopMode): Promise<void> {
    this.cancelReconnect(whatsappId);
    this.qrRetryCounters.delete(whatsappId);
    this.reconnectAttempts.delete(whatsappId);
    // Marca sincronamente a sessao condenada: um start() concorrente nao a
    // devolve enquanto o teardown aguarda na fila.
    const condemned = this.activeSessions.get(whatsappId);
    if (condemned) condemned.closing = true;

    await this.enqueue(whatsappId, async () => {
      const session = this.activeSessions.get(whatsappId);
      if (!session) return;
      await this.teardownSession(session, mode === "logout");
      await this.releaseLeaseQuietly(whatsappId, session.generation);
    });
  }

  /**
   * Stop condicional a geracao: so derruba a sessao se ela ainda for
   * exatamente a geracao informada — revalidado dentro da fila, na fronteira
   * assincrona do teardown. Callbacks de geracoes substituidas nao encerram
   * a sessao nova. Retorna true somente quando derrubou (o chamador usa isso
   * para decidir se agenda reconexao).
   */
  async stopIfCurrent(
    whatsappId: number,
    generation: string,
    mode: SessionStopMode
  ): Promise<boolean> {
    const session = this.activeSessions.get(whatsappId);
    if (!session || session.closing || session.generation !== generation) {
      return false;
    }
    session.closing = true;
    this.cancelReconnect(whatsappId);
    this.qrRetryCounters.delete(whatsappId);

    let stopped = false;
    await this.enqueue(whatsappId, async () => {
      // Revalidacao na fronteira assincrona: se um replace publicou outra
      // geracao enquanto este stop aguardava na fila, nao derruba.
      if (this.activeSessions.get(whatsappId) !== session) return;
      await this.teardownSession(session, mode === "logout");
      await this.releaseLeaseQuietly(whatsappId, session.generation);
      stopped = true;
    });
    return stopped;
  }

  /**
   * Sessao pronta para envio (socket autenticado). Espera ate timeoutMs pela
   * reconexao — mesma semantica do waitForWbot legado: 503 ao expirar.
   */
  async getReady(
    whatsappId: number,
    timeoutMs = DEFAULT_RECONNECT_WAIT_MS
  ): Promise<ManagedSession> {
    return waitForSessionReady(() => {
      const session = this.activeSessions.get(whatsappId);
      if (session && !session.closing && session.socket.user) {
        return session;
      }
      return undefined;
    }, timeoutMs);
  }

  /**
   * Sessao gerenciada em qualquer estagio (inclusive QR/opening) — semantica
   * do getWbot legado, que devolve sockets pre-autenticados.
   */
  getActive(whatsappId: number): ManagedSession {
    const session = this.activeSessions.get(whatsappId);
    if (!session || session.closing) {
      throw new AppError("ERR_WAPP_NOT_INITIALIZED");
    }
    return session;
  }

  getActiveIfPresent(whatsappId: number): ManagedSession | undefined {
    const session = this.activeSessions.get(whatsappId);
    return session && !session.closing ? session : undefined;
  }

  isCurrent(whatsappId: number, generation: string): boolean {
    const session = this.activeSessions.get(whatsappId);
    return (
      !!session && !session.closing && session.generation === generation
    );
  }

  /**
   * Executa um efeito persistente somente se a geracao ainda for vigente.
   * Retorna undefined quando a geracao esta obsoleta (efeito suprimido).
   */
  async runFenced<T>(
    whatsappId: number,
    generation: string,
    effect: () => Promise<T> | T
  ): Promise<T | undefined> {
    if (!this.isCurrent(whatsappId, generation)) {
      logger.warn(
        { whatsappId },
        "session-manager: efeito suprimido por geracao obsoleta"
      );
      return undefined;
    }
    return effect();
  }

  /** Agenda a unica reconexao permitida por canal (timers soltos morrem aqui). */
  scheduleReconnect(whatsappId: number, delayMs: number, fn: () => void): void {
    this.cancelReconnect(whatsappId);
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(whatsappId);
      fn();
    }, delayMs);
    if (typeof timer.unref === "function") timer.unref();
    this.reconnectTimers.set(whatsappId, timer);
  }

  cancelReconnect(whatsappId: number): void {
    const timer = this.reconnectTimers.get(whatsappId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(whatsappId);
    }
  }

  /**
   * Reconexao com teto (policy): conta tentativas consecutivas por canal e
   * recusa agendamentos acima de maxAttempts (tratar como terminal
   * operacional). O contador zera somente no open da sessao ou em stop
   * manual. Retorna false quando o agendamento foi recusado.
   */
  tryScheduleReconnect(
    whatsappId: number,
    delayMs: number,
    maxAttempts: number,
    fn: () => void
  ): boolean {
    const attempts = this.reconnectAttempts.get(whatsappId) || 0;
    if (attempts >= maxAttempts) {
      logger.warn(
        { whatsappId, reconnectAttempts: attempts, maxAttempts },
        "session-manager: teto de reconexoes atingido; tratar como terminal operacional"
      );
      return false;
    }
    this.reconnectAttempts.set(whatsappId, attempts + 1);
    this.scheduleReconnect(whatsappId, delayMs, fn);
    return true;
  }

  /** Chamado no "open" da sessao: reconexoes voltam a contar do zero. */
  resetReconnectAttempts(whatsappId: number): void {
    this.reconnectAttempts.delete(whatsappId);
  }

  /** Contadores de QR por canal (absorve o retriesQrCodeMap legado). */
  incrementQrRetries(whatsappId: number): number {
    const next = (this.qrRetryCounters.get(whatsappId) || 0) + 1;
    this.qrRetryCounters.set(whatsappId, next);
    return next;
  }

  getQrRetries(whatsappId: number): number {
    return this.qrRetryCounters.get(whatsappId) || 0;
  }

  resetQrRetries(whatsappId: number): void {
    this.qrRetryCounters.delete(whatsappId);
  }

  diagnostics(whatsappId: number): SessionDiagnostics {
    const session = this.activeSessions.get(whatsappId);
    return {
      whatsappId,
      hasActiveSession: !!session && !session.closing,
      generation: session && !session.closing ? session.generation : null,
      inFlight: this.inFlightConnections.has(whatsappId),
      reconnectScheduled: this.reconnectTimers.has(whatsappId),
      qrRetries: this.getQrRetries(whatsappId),
      renewalFailures: this.renewalFailures.get(whatsappId) || 0,
      reconnectAttempts: this.reconnectAttempts.get(whatsappId) || 0,
      activeSocketCount: session && !session.closing ? 1 : 0
    };
  }

  /**
   * Serializa operacoes de lifecycle por canal: cada operacao so comeca
   * quando a anterior do mesmo canal assentou. Isso elimina as corridas
   * stop-durante-start e start-durante-replace.
   */
  private enqueue<T>(whatsappId: number, op: () => Promise<T>): Promise<T> {
    const previous = this.channelOps.get(whatsappId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(op);
    this.channelOps.set(whatsappId, next);
    const cleanup = (): void => {
      if (this.channelOps.get(whatsappId) === next) {
        this.channelOps.delete(whatsappId);
      }
    };
    next.then(cleanup, cleanup);
    return next;
  }

  private async acquireAndStart(
    input: StartSessionInput
  ): Promise<ManagedSession> {
    const { id, companyId } = input.whatsapp;

    // Sem lease vigente nenhum socket abre: erros de aquisicao propagam. O
    // repositorio incrementa o fencingToken em TODA aquisicao por conflito:
    // geracoes sao monotonicas e nunca recicladas entre ciclos.
    const lease = await acquireSessionLease({
      whatsappId: id,
      ownerId: this.ownerId,
      ttlMs: this.leaseTtlMs
    });
    if (!lease) {
      throw new AppError("ERR_WAPP_SESSION_LEASE_UNAVAILABLE", 409);
    }

    try {
      // A factory devolve o socket ainda em opening (QR/pareamento), o que
      // permite heartbeat da lease durante todo o ciclo de vida. A geracao
      // vai no input para os callbacks do socket validarem efeitos.
      const socket = await this.socketFactory({
        ...input,
        generation: lease.fencingToken
      });
      const session: ManagedSession = {
        whatsappId: id,
        companyId,
        generation: lease.fencingToken,
        socket,
        closing: false
      };
      this.activeSessions.set(id, session);
      this.renewalFailures.delete(id);
      this.startHeartbeat(session);
      input.onCreated?.(session);
      return session;
    } catch (error) {
      await this.releaseLeaseQuietly(id, lease.fencingToken);
      throw error;
    }
  }

  private async teardownSession(
    session: ManagedSession,
    logout = false
  ): Promise<void> {
    session.closing = true;
    if (this.activeSessions.get(session.whatsappId) === session) {
      this.activeSessions.delete(session.whatsappId);
    }
    this.stopHeartbeat(session.whatsappId);
    this.renewalFailures.delete(session.whatsappId);
    try {
      session.socket.ev.removeAllListeners();
    } catch (error) {
      logger.warn(
        { whatsappId: session.whatsappId },
        "session-manager: falha ao remover listeners na troca de sessao"
      );
    }
    if (logout && session.socket.logout) {
      try {
        // Logout serializado: so depois de concluido o socket e fechado.
        await session.socket.logout();
      } catch (error) {
        logger.warn(
          { whatsappId: session.whatsappId },
          "session-manager: falha no logout do socket"
        );
      }
    }
    try {
      session.socket.ws.close();
    } catch (error) {
      logger.warn(
        { whatsappId: session.whatsappId },
        "session-manager: falha ao fechar socket na troca de sessao"
      );
    }
  }

  private startHeartbeat(session: ManagedSession): void {
    const { whatsappId } = session;
    this.stopHeartbeat(whatsappId);
    const timer = setInterval(() => {
      void this.heartbeatTick(session);
    }, this.heartbeatIntervalMs);
    if (typeof timer.unref === "function") timer.unref();
    this.heartbeatTimers.set(whatsappId, timer);
  }

  private stopHeartbeat(whatsappId: number): void {
    const timer = this.heartbeatTimers.get(whatsappId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(whatsappId);
    }
  }

  /** Heartbeat sem sobreposicao: um tick pendente bloqueia o seguinte. */
  private async heartbeatTick(session: ManagedSession): Promise<void> {
    const { whatsappId } = session;
    if (this.heartbeatRunning.has(whatsappId)) return;
    if (this.activeSessions.get(whatsappId) !== session) return;

    this.heartbeatRunning.add(whatsappId);
    try {
      const renewed = await renewSessionLease({
        whatsappId,
        ownerId: this.ownerId,
        fencingToken: session.generation,
        ttlMs: this.leaseTtlMs
      });
      if (!renewed) {
        logger.warn(
          { whatsappId },
          "session-manager: lease pertence a outro owner; fechando socket"
        );
        // Takeover definitivo: NAO reconectar (viraria loop de takeover).
        this.handleLeaseLost(session, { allowReconnect: false });
        return;
      }
      this.renewalFailures.delete(whatsappId);
    } catch (error) {
      const failures = (this.renewalFailures.get(whatsappId) || 0) + 1;
      this.renewalFailures.set(whatsappId, failures);
      logger.warn(
        { whatsappId, renewalFailures: failures },
        "session-manager: falha ao renovar lease da sessao"
      );
      if (failures >= this.maxRenewalFailures) {
        // Falhas transitorias: o processo provavelmente ainda e o dono;
        // rearma o canal pelo caminho gerenciado.
        this.handleLeaseLost(session, { allowReconnect: true });
      }
    } finally {
      this.heartbeatRunning.delete(whatsappId);
    }
  }

  /** Perda definitiva de ownership: fecha o socket imediatamente. */
  private handleLeaseLost(
    session: ManagedSession,
    { allowReconnect }: { allowReconnect: boolean }
  ): void {
    if (this.activeSessions.get(session.whatsappId) !== session) return;
    void this.teardownSession(session).catch(() => undefined);
    if (allowReconnect && this.onSessionEnded) {
      this.scheduleReconnect(
        session.whatsappId,
        LEASE_LOSS_RECONNECT_DELAY_MS,
        () => {
          this.onSessionEnded?.(session.whatsappId);
        }
      );
    }
  }

  private async releaseLeaseQuietly(
    whatsappId: number,
    fencingToken: string
  ): Promise<void> {
    try {
      await releaseSessionLease({
        whatsappId,
        ownerId: this.ownerId,
        fencingToken
      });
    } catch (error) {
      logger.warn(
        { whatsappId },
        "session-manager: falha ao liberar lease; expiracao por TTL cobre o residuo"
      );
    }
  }
}

let defaultManager: WhatsAppSessionManager | null = null;

/** Configura o singleton do processo (chamado uma vez por libs/wbot). */
export const configureSessionManager = (
  deps: SessionManagerDeps
): WhatsAppSessionManager => {
  defaultManager = new WhatsAppSessionManager(deps);
  return defaultManager;
};

export const getSessionManager = (): WhatsAppSessionManager => {
  if (!defaultManager) {
    throw new AppError("ERR_WAPP_SESSION_MANAGER_NOT_CONFIGURED");
  }
  return defaultManager;
};
