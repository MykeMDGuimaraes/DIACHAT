import { createHash } from "crypto";
import { QueryTypes } from "sequelize";
import WhatsAppSessionKey from "./models/WhatsAppSessionKey";
import { BufferJSON } from "../adapters/baileys/BaileysExports";
import {
  decryptMessagingSecret,
  encryptMessagingSecret,
  loadMessagingKeyring,
  MessagingKeyring
} from "../security/MessagingSecretCipher";
import {
  DELIVERY_METRIC,
  incrementDeliveryCounter
} from "../telemetry/DeliveryObservability";
import { resolveAuthStoreMode, SessionKeyStoreMode } from "./authStoreMode";

/**
 * Repositorio por chave do auth-state WhatsApp (Hardening T6).
 *
 * Substitui a persistencia monolitica em `Whatsapp.session`: uma row por id
 * de chave de sinal, payload SEMPRE cifrado (AES-256-GCM via
 * MessagingSecretCipher — nunca JSON em claro) e fencing (generation,
 * revision) em toda escrita/remocao, de modo que uma escrita vencida nunca
 * sobrescreve um registro mais novo.
 *
 * Falha fechada: ciphertext invalido ou chave de criptografia ausente do
 * keyring lancam erro — o chamador (authState) nao inicia o socket.
 */

// Tipo e resolucao do modo vivem em ./authStoreMode (T9, modulo minimo sem
// adaptadores); reexportados para manter a superficie publica estavel.
export { resolveAuthStoreMode };
export type { SessionKeyStoreMode };

export const CREDS_KEY_TYPE = "creds";
export const CREDS_KEY_ID = "current";

// Teto defensivo por registro: uma chave de sinal legitima tem poucos KB;
// acima disso ha corrupcao/abuso — rejeita a remessa inteira (transacao).
export const MAX_SESSION_KEY_PAYLOAD_BYTES = 262144;

export interface SessionKeyEntry {
  /** Tipo do SignalDataTypeMap ("session", "pre-key", ...) ou "creds". */
  keyType: string;
  /** Id da chave dentro do tipo ("current" para creds). */
  keyId: string;
  /** Valor a persistir; null/undefined = tombstone (remocao fenced). */
  value: unknown;
}

export interface SessionKeyFence {
  revision: number;
  generation: number;
}

export interface SessionAuthSnapshot {
  creds: unknown | null;
  keys: Record<string, Record<string, unknown>>;
  entryCount: number;
}

interface SessionKeyRow {
  keyType: string;
  keyId: string;
  ciphertext: string;
}

const TABLE = 'messaging."WhatsAppSessionKeys"';

const getSequelize = () => {
  const sequelize = WhatsAppSessionKey.sequelize;
  if (!sequelize) {
    throw new Error("WhatsAppSessionKey model is not bound to sequelize");
  }
  return sequelize;
};

const resolveKeyring = (keyring?: MessagingKeyring): MessagingKeyring =>
  keyring ?? loadMessagingKeyring();

const serialize = (value: unknown): string => {
  const plaintext = JSON.stringify(value, BufferJSON.replacer, 0);
  if (Buffer.byteLength(plaintext, "utf8") > MAX_SESSION_KEY_PAYLOAD_BYTES) {
    throw new Error("auth-store: registro de chave excede o limite de tamanho");
  }
  return plaintext;
};

const deserialize = (plaintext: string): unknown =>
  JSON.parse(plaintext, BufferJSON.reviver);

// Predicado de fencing compartilhado pelo upsert e pelo delete: a escrita so
// aterrissa se (generation, revision) do registro existente for anterior ou
// igual a da escrita — jamais se for mais nova.
const FENCING_WHERE = `"generation" < :generation
     OR ("generation" = :generation AND "revision" <= :revision)`;

/**
 * Le SOMENTE os ids solicitados de um tipo. Ciphertext invalido lanca erro
 * (falha fechada): o socket nao inicia sobre estado ilegivel.
 */
export const getSessionKeyEntries = async ({
  whatsappId,
  keyType,
  keyIds,
  keyring
}: {
  whatsappId: number;
  keyType: string;
  keyIds: readonly string[];
  keyring?: MessagingKeyring;
}): Promise<Record<string, unknown>> => {
  if (!keyIds.length) return {};
  const activeKeyring = resolveKeyring(keyring);
  const rows = (await getSequelize().query(
    `SELECT "keyId", "ciphertext" FROM ${TABLE}
     WHERE "whatsappId" = :whatsappId AND "keyType" = :keyType
       AND "keyId" IN (:keyIds)`,
    {
      replacements: { whatsappId, keyType, keyIds: [...keyIds] },
      type: QueryTypes.SELECT
    }
  )) as SessionKeyRow[];
  return rows.reduce<Record<string, unknown>>((dict, row) => {
    dict[row.keyId] = deserialize(
      decryptMessagingSecret(row.ciphertext, activeKeyring)
    );
    return dict;
  }, {});
};

/**
 * Carrega o snapshot completo do canal (boot nos modos novos, comparacao de
 * digest do dual_write). Falha fechada em qualquer registro ilegivel.
 */
export const loadSessionAuthSnapshot = async ({
  whatsappId,
  keyring
}: {
  whatsappId: number;
  keyring?: MessagingKeyring;
}): Promise<SessionAuthSnapshot> => {
  const activeKeyring = resolveKeyring(keyring);
  const rows = (await getSequelize().query(
    `SELECT "keyType", "keyId", "ciphertext" FROM ${TABLE}
     WHERE "whatsappId" = :whatsappId`,
    { replacements: { whatsappId }, type: QueryTypes.SELECT }
  )) as SessionKeyRow[];
  const snapshot: SessionAuthSnapshot = {
    creds: null,
    keys: {},
    entryCount: 0
  };
  for (const row of rows) {
    const value = deserialize(
      decryptMessagingSecret(row.ciphertext, activeKeyring)
    );
    snapshot.entryCount += 1;
    if (row.keyType === CREDS_KEY_TYPE) {
      snapshot.creds = value;
    } else {
      snapshot.keys[row.keyType] = snapshot.keys[row.keyType] || {};
      snapshot.keys[row.keyType][row.keyId] = value;
    }
  }
  return snapshot;
};

const applyEntry = async (
  whatsappId: number,
  entry: SessionKeyEntry,
  fence: SessionKeyFence,
  keyring: MessagingKeyring,
  transaction: any
): Promise<void> => {
  const replacements = {
    whatsappId,
    keyType: entry.keyType,
    keyId: entry.keyId,
    revision: fence.revision,
    generation: fence.generation
  };
  if (entry.value === null || entry.value === undefined) {
    // Tombstone: remocao fenced — um delete vencido nao apaga chave nova.
    await getSequelize().query(
      `DELETE FROM ${TABLE}
       WHERE "whatsappId" = :whatsappId AND "keyType" = :keyType
         AND "keyId" = :keyId AND (${FENCING_WHERE})`,
      { replacements, transaction }
    );
    return;
  }
  const ciphertext = encryptMessagingSecret(serialize(entry.value), keyring);
  const rows = (await getSequelize().query(
    `INSERT INTO ${TABLE}
       ("whatsappId", "keyType", "keyId", "ciphertext", "revision", "generation", "createdAt", "updatedAt")
     VALUES
       (:whatsappId, :keyType, :keyId, :ciphertext, :revision, :generation, NOW(), NOW())
     ON CONFLICT ("whatsappId", "keyType", "keyId") DO UPDATE
       SET "ciphertext" = :ciphertext, "revision" = :revision,
           "generation" = :generation, "updatedAt" = NOW()
       WHERE ${FENCING_WHERE}
     RETURNING "keyId"`,
    {
      replacements: { ...replacements, ciphertext },
      transaction,
      type: QueryTypes.SELECT
    }
  )) as unknown[];
  if (rows.length === 0) {
    // Fencing rejeitou a escrita (registro mais novo vigente) — conflito de
    // revisão/geração (T7): a escrita stale NÃO foi aceita.
    incrementDeliveryCounter(DELIVERY_METRIC.AUTH_REVISION_CONFLICT_TOTAL, {
      whatsappId
    });
  }
};

/**
 * Grava SOMENTE os ids alterados (uma instrucao por entrada, em uma unica
 * transacao): upsert cifrado com fencing ou tombstone fenced. Qualquer falha
 * aborta a remessa inteira — nunca persiste lote parcial.
 */
export const setSessionKeyEntries = async ({
  whatsappId,
  entries,
  fence,
  keyring,
  transaction
}: {
  whatsappId: number;
  entries: readonly SessionKeyEntry[];
  fence: SessionKeyFence;
  keyring?: MessagingKeyring;
  transaction?: any;
}): Promise<void> => {
  if (!entries.length) return;
  const activeKeyring = resolveKeyring(keyring);
  if (transaction) {
    for (const entry of entries) {
      // eslint-disable-next-line no-await-in-loop
      await applyEntry(whatsappId, entry, fence, activeKeyring, transaction);
    }
    return;
  }
  await getSequelize().transaction(async innerTransaction => {
    for (const entry of entries) {
      // Lote ordenado: mesma fila serializada do canal (Task 3) alimenta.
      // eslint-disable-next-line no-await-in-loop
      await applyEntry(
        whatsappId,
        entry,
        fence,
        activeKeyring,
        innerTransaction
      );
    }
  });
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    // Entradas null/undefined equivalem a chave ausente (tombstone): o JSON
    // legado as mantem e o postgres as remove — o digest as trata igual.
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(
          ([, entryValue]) => entryValue !== null && entryValue !== undefined
        )
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, canonicalize(entryValue)])
    );
  }
  return value;
};

/**
 * Digest canonico (sha256) do snapshot — usado pelo dual_write para detectar
 * divergencia entre o JSON legado e o PostgreSQL SEM logar payload.
 */
export const sessionAuthDigest = (snapshot: {
  creds: unknown;
  keys: unknown;
}): string =>
  createHash("sha256")
    .update(JSON.stringify(canonicalize(snapshot)))
    .digest("hex");
