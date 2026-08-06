import type {
  AuthenticationCreds,
  AuthenticationState,
  SignalDataTypeMap
} from "../messaging/public/baileys";
import { BufferJSON, initAuthCreds, proto } from "../messaging/public/baileys";
import sequelize from "../database";
import Whatsapp from "../models/Whatsapp";
import { enqueueAuthStateWrite } from "./authStateWriter";
import {
  CREDS_KEY_ID,
  CREDS_KEY_TYPE,
  getSessionKeyEntries,
  loadSessionAuthSnapshot,
  resolveAuthStoreModeForCompany,
  sessionAuthDigest,
  setSessionKeyEntries,
  SessionKeyEntry,
  SessionKeyStoreMode
} from "../messaging/public/authStore";
import { logger } from "../utils/logger";

const KEY_MAP: { [T in keyof SignalDataTypeMap]: string } = {
  "pre-key": "preKeys",
  session: "sessions",
  "sender-key": "senderKeys",
  "app-state-sync-key": "appStateSyncKeys",
  "app-state-sync-version": "appStateVersions",
  "sender-key-memory": "senderKeyMemory"
};

const REVERSE_KEY_MAP: Record<string, keyof SignalDataTypeMap> = {
  preKeys: "pre-key",
  sessions: "session",
  senderKeys: "sender-key",
  appStateSyncKeys: "app-state-sync-key",
  appStateVersions: "app-state-sync-version",
  senderKeyMemory: "sender-key-memory"
};

export interface AuthStateOptions {
  /**
   * Fence de geração (Task 2/3 do hardening): vale para creds.update E para
   * o keys.set interno do Baileys. Avaliado na EXECUÇÃO da fila — uma
   * escrita enfileirada vigente mas executada após um replace fica inerte.
   */
  shouldPersist?: () => boolean;
  /**
   * Chamado uma única vez quando as falhas consecutivas de escrita atingem
   * o limite (ver authStateWriter): o dono do ciclo de vida fecha e
   * sinaliza a sessão, preservando o último snapshot válido.
   */
  onPersistentFailure?: (whatsappId: number) => void | Promise<void>;
}

interface AuthStateResult {
  state: AuthenticationState;
  saveState: () => Promise<void>;
}

/**
 * Modo json (legado, padrão): snapshot monolítico em `Whatsapp.session`.
 * Toda escrita entra na fila serializada do canal (Task 3): o snapshot é
 * obtido DENTRO da fila, então mutações concorrentes de keys.set já foram
 * aplicadas ao estado em memória e nenhuma chave se perde entre enfileirar
 * e persistir.
 */
const jsonAuthState = async (
  whatsapp: Whatsapp,
  options: AuthStateOptions
): Promise<AuthStateResult> => {
  const shouldPersist = options.shouldPersist ?? (() => true);
  let creds: AuthenticationCreds;
  let keys: any = {};

  const saveState = (): Promise<void> =>
    enqueueAuthStateWrite({
      whatsappId: whatsapp.id,
      shouldWrite: shouldPersist,
      onPersistentFailure: options.onPersistentFailure,
      persist: () =>
        whatsapp.update({
          session: JSON.stringify({ creds, keys }, BufferJSON.replacer, 0)
        })
    });

  if (whatsapp.session && whatsapp.session !== null) {
    const result = JSON.parse(whatsapp.session, BufferJSON.reviver);
    creds = result.creds;
    keys = result.keys;
  } else {
    creds = initAuthCreds();
    keys = {};
  }

  return {
    state: {
      creds,
      keys: {
        get: (type, ids) => {
          const key = KEY_MAP[type];
          return ids.reduce((dict: any, id) => {
            let value = keys[key]?.[id];
            if (value) {
              if (type === "app-state-sync-key") {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              dict[id] = value;
            }
            return dict;
          }, {});
        },
        set: (data: any) => {
          // eslint-disable-next-line no-restricted-syntax, guard-for-in
          for (const i in data) {
            const key = KEY_MAP[i as keyof SignalDataTypeMap];
            keys[key] = keys[key] || {};
            Object.assign(keys[key], data[i]);
          }
          // keys.set aguarda a fila: quem chama com await (libsignal) só
          // continua após a escrita assentar; quem não aguarda fica coberto
          // pelo guard de rejeição do escritor.
          return saveState();
        }
      }
    },
    saveState
  };
};

// Normaliza as chaves do JSON legado (buckets "sessions"/"preKeys"/...) para
// o shape por tipo do armazenamento por chave — base da comparação de digest
// do dual_write.
const normalizeLegacyKeys = (
  legacyKeys: any
): Record<string, Record<string, unknown>> => {
  const normalized: Record<string, Record<string, unknown>> = {};
  for (const [bucket, type] of Object.entries(REVERSE_KEY_MAP)) {
    const values = legacyKeys?.[bucket];
    if (values) normalized[type] = values;
  }
  return normalized;
};

const legacyKeysFromStore = (
  storeKeys: Record<string, Record<string, unknown>>
): any => {
  const legacy: any = {};
  for (const [type, values] of Object.entries(storeKeys)) {
    const bucket = KEY_MAP[type as keyof SignalDataTypeMap];
    if (bucket) legacy[bucket] = values;
  }
  return legacy;
};

/**
 * Modos por chave (Hardening T6): PostgreSQL criptografado é a fonte de
 * verdade. `dual_write` grava os dois formatos na mesma transação e lê o
 * PostgreSQL após comparação de digest; `postgres` grava/lê só por chave.
 * Fencing (generation, revision) cerca cada escrita: a geração é a época
 * (ms) desta instância e a revisão vem da fila serializada do canal — uma
 * escrita de instância vencida nunca sobrescreve registro mais novo.
 */
const keyedAuthState = async (
  whatsapp: Whatsapp,
  options: AuthStateOptions,
  mode: Exclude<SessionKeyStoreMode, "json">
): Promise<AuthStateResult> => {
  const shouldPersist = options.shouldPersist ?? (() => true);
  const generation = Date.now();
  const snapshot = await loadSessionAuthSnapshot({ whatsappId: whatsapp.id });

  let creds: AuthenticationCreds;
  let keys: any = {};

  if (mode === "dual_write") {
    const legacy = whatsapp.session
      ? JSON.parse(whatsapp.session, BufferJSON.reviver)
      : null;
    if (snapshot.entryCount > 0) {
      if (legacy) {
        const legacyDigest = sessionAuthDigest({
          creds: legacy.creds,
          keys: normalizeLegacyKeys(legacy.keys)
        });
        const storeDigest = sessionAuthDigest({
          creds: snapshot.creds,
          keys: snapshot.keys
        });
        if (legacyDigest !== storeDigest) {
          // Divergência logada SEM payload: apenas id do canal e digests.
          logger.warn(
            { whatsappId: whatsapp.id, legacyDigest, storeDigest },
            "auth-store: digest divergente entre json legado e postgres (postgres prevalece)"
          );
        }
      }
      creds = snapshot.creds as AuthenticationCreds;
      keys = legacyKeysFromStore(snapshot.keys);
    } else if (legacy) {
      logger.info(
        { whatsappId: whatsapp.id },
        "auth-store: postgres vazio; usando json legado ate o backfill"
      );
      creds = legacy.creds;
      keys = legacy.keys ?? {};
    } else {
      creds = initAuthCreds();
      keys = {};
    }
  } else if (snapshot.entryCount === 0) {
    // Canal novo: nenhuma row ainda — inicia credenciais limpas (pareamento).
    creds = initAuthCreds();
  } else {
    if (!snapshot.creds) {
      // Falha fechada: chaves presentes sem credenciais = estado
      // inconsistente; o socket NAO inicia sobre estado duvidoso.
      throw new Error(
        "auth-store: credenciais ausentes com chaves presentes (estado inconsistente)"
      );
    }
    creds = snapshot.creds as AuthenticationCreds;
  }

  const credsEntry = (): SessionKeyEntry => ({
    keyType: CREDS_KEY_TYPE,
    keyId: CREDS_KEY_ID,
    value: creds
  });

  const flattenKeyData = (data: any): SessionKeyEntry[] => {
    const entries: SessionKeyEntry[] = [];
    // eslint-disable-next-line no-restricted-syntax, guard-for-in
    for (const type in data) {
      const values = data[type];
      if (values) {
        // eslint-disable-next-line no-restricted-syntax, guard-for-in
        for (const id in values) {
          entries.push({ keyType: type, keyId: id, value: values[id] });
        }
      }
    }
    return entries;
  };

  const persistKeyed = (revision: number, entries: SessionKeyEntry[]) =>
    setSessionKeyEntries({
      whatsappId: whatsapp.id,
      entries,
      fence: { revision, generation }
    });

  const persistDual = (revision: number, entries: SessionKeyEntry[]) =>
    // JSON legado e chaves cifradas na MESMA transação: nunca divergem por
    // falha parcial — o digest só muda quando os dois lados mudam juntos.
    sequelize.transaction(async transaction => {
      await whatsapp.update(
        { session: JSON.stringify({ creds, keys }, BufferJSON.replacer, 0) },
        { transaction }
      );
      await setSessionKeyEntries({
        whatsappId: whatsapp.id,
        entries: [...entries, credsEntry()],
        fence: { revision, generation },
        transaction
      });
    });

  const saveState = (): Promise<void> =>
    enqueueAuthStateWrite({
      whatsappId: whatsapp.id,
      shouldWrite: shouldPersist,
      onPersistentFailure: options.onPersistentFailure,
      persist: revision =>
        mode === "dual_write"
          ? persistDual(revision, [])
          : persistKeyed(revision, [credsEntry()])
    });

  return {
    state: {
      creds,
      keys: {
        get:
          mode === "dual_write"
            ? (type, ids) => {
                const key = KEY_MAP[type];
                return ids.reduce((dict: any, id) => {
                  let value = keys[key]?.[id];
                  if (value) {
                    if (type === "app-state-sync-key") {
                      value =
                        proto.Message.AppStateSyncKeyData.fromObject(value);
                    }
                    dict[id] = value;
                  }
                  return dict;
                }, {});
              }
            : // postgres: leitura sob demanda — SOMENTE os ids solicitados.
              async (type, ids) => {
                const rows = await getSessionKeyEntries({
                  whatsappId: whatsapp.id,
                  keyType: type,
                  keyIds: ids
                });
                return ids.reduce((dict: any, id) => {
                  let value = rows[id];
                  if (value) {
                    if (type === "app-state-sync-key") {
                      value =
                        proto.Message.AppStateSyncKeyData.fromObject(value);
                    }
                    dict[id] = value;
                  }
                  return dict;
                }, {});
              },
        set: (data: any) => {
          const entries = flattenKeyData(data);
          if (mode === "dual_write") {
            // eslint-disable-next-line no-restricted-syntax, guard-for-in
            for (const i in data) {
              const key = KEY_MAP[i as keyof SignalDataTypeMap];
              keys[key] = keys[key] || {};
              Object.assign(keys[key], data[i]);
            }
          }
          return enqueueAuthStateWrite({
            whatsappId: whatsapp.id,
            shouldWrite: shouldPersist,
            onPersistentFailure: options.onPersistentFailure,
            persist: revision =>
              mode === "dual_write"
                ? persistDual(revision, entries)
                : persistKeyed(revision, entries)
          });
        }
      }
    },
    saveState
  };
};

const authState = async (
  whatsapp: Whatsapp,
  options: AuthStateOptions = {}
): Promise<AuthStateResult> => {
  // T9: a coorte persistida da empresa vence o default global (env). Em
  // qualquer falha de resolução, o resolvedor cai no modo global — o boot
  // nunca quebra por causa da coorte.
  const mode = await resolveAuthStoreModeForCompany(whatsapp.companyId);
  if (mode === "json") return jsonAuthState(whatsapp, options);
  return keyedAuthState(whatsapp, options, mode);
};

export default authState;
