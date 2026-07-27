/**
 * Fachada publica do modulo de mensageria para o nucleo (core).
 *
 * O core so pode consumir Baileys atraves deste arquivo; imports diretos de
 * `messaging/adapters/baileys/*` fora do modulo de mensageria violam a
 * fronteira (verificada por dependency-cruiser e checkMessagingBoundaries).
 */
export * from "../adapters/baileys/BaileysExports";
export { default } from "../adapters/baileys/BaileysExports";
export { sendBaileysSocketMessage } from "../adapters/baileys/BaileysSocketPort";
export { default as BaileysLogger } from "../adapters/baileys/BaileysLogger";
