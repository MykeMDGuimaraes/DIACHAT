/**
 * Fachada publica do modulo de mensageria para o nucleo (core).
 *
 * O core so pode consumir Baileys atraves deste arquivo; imports diretos de
 * `messaging/adapters/baileys/*` fora do modulo de mensageria violam a
 * fronteira (verificada por dependency-cruiser e checkMessagingBoundaries).
 */
export * from "../adapters/baileys/BaileysExports";
// eslint-disable-next-line no-restricted-exports
export { default } from "../adapters/baileys/BaileysExports";
// O primitivo sendBaileysSocketMessage NAO e reexportado: mensagens de
// saida passam pelo outbox (public/outbound); o core nunca envia conteudo
// direto pelo socket. Resta apenas a operacao de protocolo de revogacao.
export { deleteBaileysMessage } from "../adapters/baileys/BaileysSocketPort";
export { default as BaileysLogger } from "../adapters/baileys/BaileysLogger";
export { registerBaileysMirrorLifecycleListeners } from "../adapters/baileys/BaileysProviderEventAdapter";
export { WhatsAppProviderEventContext } from "../domain/WhatsAppProviderEvent";
export {
  parseBaileysContactIdentity,
  resolveContactJid,
  BaileysContactIdentity,
  ContactJidServer
} from "../adapters/baileys/BaileysContactIdentity";
