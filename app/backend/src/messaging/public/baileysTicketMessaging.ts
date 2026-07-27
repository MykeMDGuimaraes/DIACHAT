/**
 * Public composition seam for ticket-oriented Baileys delivery.
 *
 * This facade exports the adapter class without importing core socket/session
 * modules. The core owns composition with GetTicketWbot, which prevents the
 * public Baileys SDK facade from evaluating a core <-> messaging cycle.
 */
export { default as BaileysTicketMessagingProvider } from "../adapters/baileys/BaileysTicketMessagingProvider";
