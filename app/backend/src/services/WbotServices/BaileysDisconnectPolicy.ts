/**
 * Politica centralizada de desconexao Baileys (Task 1 do hardening).
 *
 * Classifica o statusCode do Boom de `connection=close` e decide, de forma
 * explicita, a acao e o destino dos artefatos da sessao (Whatsapp.session,
 * cache de contatos/chats do modelo Baileys). Os codigos numericos seguem o
 * enum DisconnectReason do Baileys 6.7.x — repetidos aqui como constantes
 * nomeadas para nao importar o vendor fora do adapter de mensageria.
 */

// DisconnectReason do Baileys (vendor 6.7.24)
export const WA_LOGGED_OUT = 401;
export const WA_FORBIDDEN = 403;
export const WA_TIMED_OUT = 408;
export const WA_CONNECTION_CLOSED = 428;
export const WA_CONNECTION_REPLACED = 440;
export const WA_REJECTION_COOLDOWN = 463;
export const WA_BAD_SESSION = 500;
export const WA_RESTART_REQUIRED = 515;

export type DisconnectClass = "terminal" | "transient" | "cooldown" | "unknown";

export type DisconnectAction = "reconnect" | "terminate";

export interface DisconnectDecision {
  disconnectClass: DisconnectClass;
  action: DisconnectAction;
  // Codigo estavel para logs, metricas e eventos Socket.IO.
  reasonCode: string;
  // Destino de Whatsapp.session: true = zerar credencial (logout real).
  clearCredential: boolean;
  // Destino do cache contacts/chats (DeleteBaileysService).
  clearBaileysCache: boolean;
  // Teto de tentativas de reconexao para a classe; 0 = nunca reconecta.
  maxReconnectAttempts: number;
}

const TERMINAL_CLEARING: Record<number, string> = {
  [WA_LOGGED_OUT]: "LOGGED_OUT",
  [WA_FORBIDDEN]: "FORBIDDEN",
  [WA_BAD_SESSION]: "BAD_SESSION"
};

const TRANSIENT: Record<number, string> = {
  [WA_CONNECTION_CLOSED]: "CONNECTION_CLOSED",
  [WA_TIMED_OUT]: "TIMED_OUT",
  [WA_RESTART_REQUIRED]: "RESTART_REQUIRED"
};

export const classifyDisconnect = (
  statusCode?: number | null
): DisconnectClass => {
  if (statusCode == null) return "unknown";
  if (TERMINAL_CLEARING[statusCode] || statusCode === WA_CONNECTION_REPLACED) {
    return "terminal";
  }
  if (TRANSIENT[statusCode]) return "transient";
  if (statusCode === WA_REJECTION_COOLDOWN) return "cooldown";
  return "unknown";
};

export const decideDisconnect = (
  statusCode?: number | null
): DisconnectDecision => {
  if (statusCode != null && TERMINAL_CLEARING[statusCode]) {
    return {
      disconnectClass: "terminal",
      action: "terminate",
      reasonCode: TERMINAL_CLEARING[statusCode],
      clearCredential: true,
      clearBaileysCache: true,
      maxReconnectAttempts: 0
    };
  }

  if (statusCode === WA_CONNECTION_REPLACED) {
    // Outra instancia assumiu a sessao. Nao reconectar (viraria loop de
    // takeover) e NAO apagar a credencial como se fosse logout — o pareamento
    // continua valido no lado do WhatsApp.
    return {
      disconnectClass: "terminal",
      action: "terminate",
      reasonCode: "CONNECTION_REPLACED",
      clearCredential: false,
      clearBaileysCache: false,
      maxReconnectAttempts: 0
    };
  }

  if (statusCode != null && TRANSIENT[statusCode]) {
    return {
      disconnectClass: "transient",
      action: "reconnect",
      reasonCode: TRANSIENT[statusCode],
      clearCredential: false,
      clearBaileysCache: false,
      // Reconexao sob single-flight com backoff; o teto finito e aplicado
      // pelo agendador do SessionManager (Task 2), nao aqui.
      maxReconnectAttempts: Number.POSITIVE_INFINITY
    };
  }

  if (statusCode === WA_REJECTION_COOLDOWN) {
    // Servidor recusou a sessao (timelock). Encerrar o loop, preservar a
    // credencial para avaliacao e exigir intervencao/repareamento.
    return {
      disconnectClass: "cooldown",
      action: "terminate",
      reasonCode: "REJECTION_COOLDOWN",
      clearCredential: false,
      clearBaileysCache: false,
      maxReconnectAttempts: 0
    };
  }

  // Codigo ausente ou desconhecido: uma unica tentativa controlada; se
  // repetir, o consumidor deve tratar como terminal operacional e alertar.
  return {
    disconnectClass: "unknown",
    action: "reconnect",
    reasonCode: "UNKNOWN_DISCONNECT",
    clearCredential: false,
    clearBaileysCache: false,
    maxReconnectAttempts: 1
  };
};
