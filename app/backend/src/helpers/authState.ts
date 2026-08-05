import type {
  AuthenticationCreds,
  AuthenticationState,
  SignalDataTypeMap
} from "../messaging/public/baileys";
import { BufferJSON, initAuthCreds, proto } from "../messaging/public/baileys";
import Whatsapp from "../models/Whatsapp";
import { enqueueAuthStateWrite } from "./authStateWriter";

const KEY_MAP: { [T in keyof SignalDataTypeMap]: string } = {
  "pre-key": "preKeys",
  session: "sessions",
  "sender-key": "senderKeys",
  "app-state-sync-key": "appStateSyncKeys",
  "app-state-sync-version": "appStateVersions",
  "sender-key-memory": "senderKeyMemory"
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

const authState = async (
  whatsapp: Whatsapp,
  options: AuthStateOptions = {}
): Promise<{
  state: AuthenticationState;
  saveState: () => Promise<void>;
}> => {
  const shouldPersist = options.shouldPersist ?? (() => true);
  let creds: AuthenticationCreds;
  let keys: any = {};

  // Toda escrita entra na fila serializada do canal (Task 3): o snapshot é
  // obtido DENTRO da fila, então mutações concorrentes de keys.set já foram
  // aplicadas ao estado em memória e nenhuma chave se perde entre
  // enfileirar e persistir. O formato JSON monolítico e o BufferJSON são
  // mantidos — armazenamento por chave criptografada é Task 6.
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

export default authState;
