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

// Coorte de rollout por empresa (T9): o modo persistido da empresa vence o
// default global (env). Core consome somente por aqui (fronteira depcruise).
export {
  AUTH_STORE_COHORT_CAPABILITY,
  flushAuthStoreCohortCache,
  resolveAuthStoreModeForCompany
} from "../persistence/AuthStoreCohortResolver";
