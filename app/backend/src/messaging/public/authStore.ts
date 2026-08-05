/**
 * Fachada publica do armazenamento por chave do auth-state (Hardening T6).
 * O core (helpers/authState) consome a persistencia criptografada somente
 * por aqui — nunca importa src/messaging/persistence diretamente (fronteira
 * depcruise).
 */
export {
  CREDS_KEY_ID,
  CREDS_KEY_TYPE,
  MAX_SESSION_KEY_PAYLOAD_BYTES,
  getSessionKeyEntries,
  loadSessionAuthSnapshot,
  resolveAuthStoreMode,
  sessionAuthDigest,
  setSessionKeyEntries,
  SessionAuthSnapshot,
  SessionKeyEntry,
  SessionKeyFence,
  SessionKeyStoreMode
} from "../persistence/WhatsAppSessionKeyRepository";
