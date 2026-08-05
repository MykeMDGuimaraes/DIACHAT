import authState from "../authState";
import { logger } from "../../utils/logger";

jest.mock("../../messaging/public/baileys", () => ({
  BufferJSON: { replacer: undefined, reviver: undefined },
  initAuthCreds: jest.fn(() => ({ noiseKey: {}, signedIdentityKey: {} })),
  proto: {
    Message: { AppStateSyncKeyData: { fromObject: (value: unknown) => value } }
  }
}));

// A fachada do auth-store (T6) e mockada: o modo padrao "json" exercita o
// caminho legado sem carregar o adaptador Baileys real (vendor nao
// transpilado quebra o parse do jest).
jest.mock("../../messaging/public/authStore", () => ({
  CREDS_KEY_TYPE: "creds",
  CREDS_KEY_ID: "current",
  resolveAuthStoreMode: jest.fn(() => "json"),
  loadSessionAuthSnapshot: jest.fn(),
  getSessionKeyEntries: jest.fn(),
  setSessionKeyEntries: jest.fn().mockResolvedValue(undefined),
  sessionAuthDigest: jest.fn(() => "digest")
}));

jest.mock("../../utils/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

const makeWhatsapp = (id: number) =>
  ({
    id,
    session: "",
    update: jest.fn().mockResolvedValue([1])
  } as any);

const tick = (): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, 0));

const lastPersistedSession = (whatsapp: any): any =>
  JSON.parse(
    whatsapp.update.mock.calls[whatsapp.update.mock.calls.length - 1][0].session
  );

beforeEach(() => {
  jest.clearAllMocks();
});

describe("authState", () => {
  it("persiste credenciais enquanto a geracao e vigente", async () => {
    const whatsapp = makeWhatsapp(1);
    const { saveState } = await authState(whatsapp, {
      shouldPersist: () => true
    });

    await saveState();

    expect(whatsapp.update).toHaveBeenCalledWith({
      session: expect.any(String)
    });
  });

  it("para de persistir quando a geracao e substituida — inclusive via keys.set", async () => {
    const whatsapp = makeWhatsapp(2);
    let current = true;
    const { state, saveState } = await authState(whatsapp, {
      shouldPersist: () => current
    });

    await saveState();
    expect(whatsapp.update).toHaveBeenCalledTimes(1);

    // Geracao substituida: nem creds.update nem keys.set gravam mais nada.
    current = false;
    state.keys.set({ session: { "1:abc": {} } } as any);
    await saveState();

    expect(whatsapp.update).toHaveBeenCalledTimes(1);
  });

  it("sem guarda (padrao) persiste sempre — compatibilidade legada", async () => {
    const whatsapp = makeWhatsapp(3);
    const { state } = await authState(whatsapp);

    state.keys.set({ session: { "1:abc": {} } } as any);
    await tick();

    expect(whatsapp.update).toHaveBeenCalled();
  });

  it("duas mutacoes concorrentes persistem em ordem, serializadas e sem perder chaves", async () => {
    const whatsapp = makeWhatsapp(11);
    const order: string[] = [];
    let releaseFirst!: () => void;
    let calls = 0;
    whatsapp.update.mockImplementation(() => {
      calls += 1;
      const n = calls;
      order.push(`start${n}`);
      if (n === 1) {
        return new Promise(resolve => {
          releaseFirst = () => {
            order.push("end1");
            resolve([1]);
          };
        });
      }
      order.push(`end${n}`);
      return Promise.resolve([1]);
    });

    const { state } = await authState(whatsapp);
    const writeA = state.keys.set({
      session: { "1:a": { pre: true } }
    } as any) as unknown as Promise<void>;
    const writeB = state.keys.set({
      session: { "1:b": { pre: true } }
    } as any) as unknown as Promise<void>;

    // A primeira escrita esta em voo; a segunda aguarda a fila do canal.
    await tick();
    expect(order).toEqual(["start1"]);

    releaseFirst();
    await writeA;
    await writeB;

    // Serializacao estrita: a segunda so comeca apos a primeira assentar.
    expect(order).toEqual(["start1", "end1", "start2", "end2"]);
    // Nenhuma chave se perde: o snapshot final contem as duas mutacoes.
    const persisted = lastPersistedSession(whatsapp);
    expect(Object.keys(persisted.keys.sessions)).toEqual(
      expect.arrayContaining(["1:a", "1:b"])
    );
  });

  it("fence e avaliado na execucao: replace entre enfileirar e executar impede a escrita", async () => {
    const whatsapp = makeWhatsapp(12);
    let releaseFirst!: () => void;
    let calls = 0;
    whatsapp.update.mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return new Promise(resolve => {
          releaseFirst = () => resolve([1]);
        });
      }
      return Promise.resolve([1]);
    });

    let current = true;
    const { saveState } = await authState(whatsapp, {
      shouldPersist: () => current
    });

    const first = saveState(); // executa e trava no update deferido
    await tick();
    current = false; // geracao substituida enquanto a fila estava ocupada
    const second = saveState(); // enfileirada vigente, executada vencida

    releaseFirst();
    await first;
    await second;

    // So a primeira escrita tocou o banco; a vencida foi rejeitada pela fila.
    expect(whatsapp.update).toHaveBeenCalledTimes(1);
  });

  it("falha de banco rejeita a operacao e gera log estruturado (nunca console.log)", async () => {
    const whatsapp = makeWhatsapp(13);
    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    whatsapp.update.mockRejectedValueOnce(new Error("db down"));

    const { saveState } = await authState(whatsapp);

    await expect(saveState()).rejects.toThrow("db down");
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        whatsappId: 13,
        revision: expect.any(Number),
        failures: 1
      }),
      expect.stringContaining("credenciais")
    );
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("creds.update aguarda a fila de escrita do canal", async () => {
    const whatsapp = makeWhatsapp(14);
    let release!: () => void;
    whatsapp.update.mockImplementation(
      () =>
        new Promise(resolve => {
          release = () => resolve([1]);
        })
    );

    const { saveState } = await authState(whatsapp);
    let settled = false;
    const pending = saveState().then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );

    await tick();
    expect(whatsapp.update).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false); // ainda aguardando a escrita assentar

    release();
    await pending;
    expect(settled).toBe(true);
  });

  it("replace durante escrita falha em voo: falha nao conta nem sinaliza a sessao", async () => {
    const whatsapp = makeWhatsapp(16);
    let rejectFirst!: (error: Error) => void;
    whatsapp.update.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectFirst = reject;
        })
    );
    const onPersistentFailure = jest.fn();
    let current = true;
    const { saveState } = await authState(whatsapp, {
      shouldPersist: () => current,
      onPersistentFailure
    });

    // Escrita em voo; o canal e substituido ANTES da falha assentar.
    const failing = saveState();
    await tick();
    current = false;
    rejectFirst(new Error("db down"));

    await expect(failing).rejects.toThrow("db down");
    // Geracao vencida: sem log de erro de persistencia e sem sinalizacao.
    expect(logger.error).not.toHaveBeenCalled();
    expect(onPersistentFailure).not.toHaveBeenCalled();

    // A falha da geracao vencida nao entra no contador do canal: duas
    // falhas vigentes ainda nao atingem o limite (seriam 3 se a primeira
    // tivesse contado); a terceira atinge.
    current = true;
    whatsapp.update.mockRejectedValue(new Error("db down"));
    await expect(saveState()).rejects.toThrow("db down");
    await expect(saveState()).rejects.toThrow("db down");
    expect(onPersistentFailure).not.toHaveBeenCalled();
    await expect(saveState()).rejects.toThrow("db down");
    expect(onPersistentFailure).toHaveBeenCalledTimes(1);
    expect(onPersistentFailure).toHaveBeenCalledWith(16);
  });

  it("falhas repetidas sinalizam a sessao uma unica vez e sucesso zera o contador", async () => {
    const whatsapp = makeWhatsapp(15);
    const onPersistentFailure = jest.fn();
    const { saveState } = await authState(whatsapp, {
      onPersistentFailure
    });

    whatsapp.update.mockRejectedValue(new Error("db down"));
    await expect(saveState()).rejects.toThrow("db down");
    await expect(saveState()).rejects.toThrow("db down");
    await expect(saveState()).rejects.toThrow("db down");
    // Limite atingido: sinaliza uma vez; falhas alem do limite nao repetem.
    await expect(saveState()).rejects.toThrow("db down");
    expect(onPersistentFailure).toHaveBeenCalledTimes(1);
    expect(onPersistentFailure).toHaveBeenCalledWith(15);

    // Nenhuma escrita apagou o ultimo snapshot valido (session nunca vazia).
    for (const call of whatsapp.update.mock.calls) {
      expect(call[0].session).not.toBe("");
    }

    // Sucesso zera o contador: novas falhas contam do zero.
    whatsapp.update.mockResolvedValue([1]);
    await saveState();
    whatsapp.update.mockRejectedValue(new Error("db down"));
    await expect(saveState()).rejects.toThrow("db down");
    await expect(saveState()).rejects.toThrow("db down");
    expect(onPersistentFailure).toHaveBeenCalledTimes(1);
  });
});
