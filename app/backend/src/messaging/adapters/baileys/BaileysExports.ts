/**
 * Single import boundary for Baileys.
 *
 * Legacy modules consume types and helpers through this facade while the
 * package itself remains private to the messaging adapter.
 */
export { default } from "baileys";
export * from "baileys";
