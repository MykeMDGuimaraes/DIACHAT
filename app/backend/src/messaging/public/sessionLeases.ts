/**
 * Fachada publica da lease de sessao WhatsApp. O core (wbot/SessionManager)
 * consome a exclusividade entre processos somente por aqui — nunca importa
 * internals de src/messaging/persistence diretamente (fronteira depcruise).
 */
export {
  acquireSessionLease,
  renewSessionLease,
  releaseSessionLease,
  SessionLease,
  AcquireLeaseInput
} from "../persistence/WhatsAppSessionLeaseRepository";
