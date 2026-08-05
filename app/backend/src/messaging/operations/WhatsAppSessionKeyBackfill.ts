import { BufferJSON } from "../adapters/baileys/BaileysExports";
import {
  CREDS_KEY_ID,
  CREDS_KEY_TYPE,
  SessionKeyEntry,
  SessionKeyFence
} from "../persistence/WhatsAppSessionKeyRepository";

/**
 * Planejamento puro do backfill de auth-state (Hardening T6): converte o
 * JSON monolítico legado (`Whatsapp.session`) em entradas por chave.
 *
 * Elegibilidade: só migra sessão com identidade pareada válida
 * (`creds.me.id`) — JSON corrompido ou sem pareamento é pulado. Tombstones
 * legados (valor null) não migram: equivalem a chave ausente.
 */

const REVERSE_KEY_MAP: Record<string, string> = {
  preKeys: "pre-key",
  sessions: "session",
  senderKeys: "sender-key",
  appStateSyncKeys: "app-state-sync-key",
  appStateVersions: "app-state-sync-version",
  senderKeyMemory: "sender-key-memory"
};

export type SessionKeyBackfillStatus = "empty" | "invalid" | "ready";

export interface SessionKeyBackfillPlan {
  status: SessionKeyBackfillStatus;
  entries: SessionKeyEntry[];
}

/**
 * Fence (0, 0): o backfill nunca sobrescreve escrita de runtime (geração de
 * época sempre > 0); reexecução regrava o mesmo conteúdo — idempotente.
 */
export const BACKFILL_FENCE: SessionKeyFence = { revision: 0, generation: 0 };

export const planSessionKeyBackfill = (
  session: string | null | undefined
): SessionKeyBackfillPlan => {
  if (!session) return { status: "empty", entries: [] };
  let parsed: any;
  try {
    parsed = JSON.parse(session, BufferJSON.reviver);
  } catch (_) {
    return { status: "invalid", entries: [] };
  }
  if (!parsed?.creds?.me?.id) {
    return { status: "invalid", entries: [] };
  }
  const entries: SessionKeyEntry[] = [
    { keyType: CREDS_KEY_TYPE, keyId: CREDS_KEY_ID, value: parsed.creds }
  ];
  for (const [bucket, keyType] of Object.entries(REVERSE_KEY_MAP)) {
    const values = parsed.keys?.[bucket];
    if (values) {
      for (const [id, value] of Object.entries(values)) {
        // Tombstones legados (valor null) nao migram: equivalem a ausencia.
        if (value !== null && value !== undefined) {
          entries.push({ keyType, keyId: id, value });
        }
      }
    }
  }
  return { status: "ready", entries };
};
