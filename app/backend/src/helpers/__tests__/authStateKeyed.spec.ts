import authState from "../authState";
import {
  getSessionKeyEntries,
  loadSessionAuthSnapshot,
  resolveAuthStoreMode,
  sessionAuthDigest,
  setSessionKeyEntries
} from "../../messaging/public/authStore";
import sequelize from "../../database";
import { logger } from "../../utils/logger";

jest.mock("../../messaging/public/baileys", () => ({
  BufferJSON: { replacer: undefined, reviver: undefined },
  initAuthCreds: jest.fn(() => ({ fresh: true })),
  proto: {
    Message: {
      AppStateSyncKeyData: {
        fromObject: (value: unknown) => ({ converted: value })
      }
    }
  }
}));

jest.mock("../../messaging/public/authStore", () => ({
  CREDS_KEY_TYPE: "creds",
  CREDS_KEY_ID: "current",
  resolveAuthStoreMode: jest.fn(() => "json"),
  loadSessionAuthSnapshot: jest.fn(),
  getSessionKeyEntries: jest.fn(),
  setSessionKeyEntries: jest.fn().mockResolvedValue(undefined),
  sessionAuthDigest: jest.fn(() => "digest")
}));

jest.mock("../../database", () => ({
  __esModule: true,
  default: { transaction: jest.fn(async (callback: any) => callback("tx")) }
}));

jest.mock("../../utils/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

const mode = resolveAuthStoreMode as jest.Mock;
const loadSnapshot = loadSessionAuthSnapshot as jest.Mock;
const getEntries = getSessionKeyEntries as jest.Mock;
const setEntries = setSessionKeyEntries as jest.Mock;
const digest = sessionAuthDigest as jest.Mock;

const makeWhatsapp = (id: number, session = "") =>
  ({
    id,
    session,
    update: jest.fn().mockResolvedValue([1])
  } as any);

beforeEach(() => {
  jest.clearAllMocks();
  mode.mockReturnValue("json");
  setEntries.mockResolvedValue(undefined);
});

describe("authState — modo postgres", () => {
  beforeEach(() => {
    mode.mockReturnValue("postgres");
    loadSnapshot.mockResolvedValue({
      creds: { me: { id: "5511" } },
      keys: {},
      entryCount: 1
    });
  });

  it("saveState persiste so a credencial, com fence de revisao/geracao", async () => {
    const whatsapp = makeWhatsapp(21);
    const { saveState } = await authState(whatsapp, {
      shouldPersist: () => true
    });

    await saveState();

    expect(setEntries).toHaveBeenCalledTimes(1);
    const call = setEntries.mock.calls[0][0];
    expect(call.whatsappId).toBe(21);
    expect(call.entries).toEqual([
      { keyType: "creds", keyId: "current", value: { me: { id: "5511" } } }
    ]);
    expect(call.fence).toEqual({
      revision: 1,
      generation: expect.any(Number)
    });
    // Modo postgres: o JSON monolitico nao e mais gravado.
    expect(whatsapp.update).not.toHaveBeenCalled();
  });

  it("keys.set grava somente os ids alterados (inclusive tombstones)", async () => {
    const whatsapp = makeWhatsapp(22);
    const { state } = await authState(whatsapp);

    await state.keys.set({
      session: { "1:a": { v: 1 }, "1:b": null },
      "pre-key": { "9": { v: 2 } }
    } as any);

    expect(setEntries).toHaveBeenCalledTimes(1);
    expect(setEntries.mock.calls[0][0].entries).toEqual([
      { keyType: "session", keyId: "1:a", value: { v: 1 } },
      { keyType: "session", keyId: "1:b", value: null },
      { keyType: "pre-key", keyId: "9", value: { v: 2 } }
    ]);
    expect(whatsapp.update).not.toHaveBeenCalled();
  });

  it("keys.get le somente os ids solicitados do repositorio", async () => {
    const whatsapp = makeWhatsapp(23);
    getEntries.mockResolvedValue({ "1:a": { v: 1 } });
    const { state } = await authState(whatsapp);

    const result = await state.keys.get("session", ["1:a", "1:b"]);

    expect(getEntries).toHaveBeenCalledWith({
      whatsappId: 23,
      keyType: "session",
      keyIds: ["1:a", "1:b"]
    });
    expect(result).toEqual({ "1:a": { v: 1 } });
  });

  it("keys.get converte app-state-sync-key via proto", async () => {
    const whatsapp = makeWhatsapp(24);
    getEntries.mockResolvedValue({ k1: { raw: true } });
    const { state } = await authState(whatsapp);

    const result = await state.keys.get("app-state-sync-key", ["k1"]);

    expect(result).toEqual({ k1: { converted: { raw: true } } });
  });

  it("falha fechada: chaves sem credenciais nao iniciam o socket", async () => {
    loadSnapshot.mockResolvedValue({
      creds: null,
      keys: { session: { "1:a": { v: 1 } } },
      entryCount: 2
    });

    await expect(authState(makeWhatsapp(25))).rejects.toThrow("inconsistente");
  });

  it("canal novo (snapshot vazio) inicia credenciais limpas", async () => {
    loadSnapshot.mockResolvedValue({ creds: null, keys: {}, entryCount: 0 });

    const { state } = await authState(makeWhatsapp(26));

    expect(state.creds).toEqual({ fresh: true });
  });
});

describe("authState — modo dual_write", () => {
  beforeEach(() => {
    mode.mockReturnValue("dual_write");
    loadSnapshot.mockResolvedValue({
      creds: { me: { id: "5511" } },
      keys: { session: { "1:a": { v: 1 } } },
      entryCount: 2
    });
  });

  it("grava os dois formatos na mesma transacao", async () => {
    const whatsapp = makeWhatsapp(27);
    const { saveState } = await authState(whatsapp);

    await saveState();

    expect(sequelize.transaction).toHaveBeenCalledTimes(1);
    expect(whatsapp.update).toHaveBeenCalledWith(
      { session: expect.any(String) },
      { transaction: "tx" }
    );
    const persisted = JSON.parse(whatsapp.update.mock.calls[0][0].session);
    expect(persisted.creds).toEqual({ me: { id: "5511" } });
    expect(setEntries).toHaveBeenCalledTimes(1);
    const call = setEntries.mock.calls[0][0];
    expect(call.transaction).toBe("tx");
    expect(call.entries).toEqual([
      { keyType: "creds", keyId: "current", value: { me: { id: "5511" } } }
    ]);
  });

  it("digest divergente e logado sem payload e o postgres prevalece", async () => {
    const whatsapp = makeWhatsapp(
      28,
      JSON.stringify({ creds: { me: { id: "outro" } }, keys: {} })
    );
    digest.mockReturnValueOnce("digest-json").mockReturnValueOnce("digest-pg");

    const { state } = await authState(whatsapp);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [meta, message] = (logger.warn as jest.Mock).mock.calls[0];
    expect(meta).toMatchObject({
      whatsappId: 28,
      legacyDigest: "digest-json",
      storeDigest: "digest-pg"
    });
    expect(message).toContain("divergente");
    // Sem payload: nada de credenciais/chaves no log.
    expect(JSON.stringify(meta)).not.toContain("outro");
    expect(JSON.stringify(meta)).not.toContain("5511");
    // PostgreSQL e a leitura principal.
    expect(state.creds).toEqual({ me: { id: "5511" } });
  });

  it("postgres vazio + json legado: usa o legado ate o backfill", async () => {
    loadSnapshot.mockResolvedValue({ creds: null, keys: {}, entryCount: 0 });
    const whatsapp = makeWhatsapp(
      29,
      JSON.stringify({ creds: { me: { id: "legado" } }, keys: {} })
    );

    const { state } = await authState(whatsapp);

    expect(state.creds).toEqual({ me: { id: "legado" } });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ whatsappId: 29 }),
      expect.stringContaining("backfill")
    );
  });

  it("keys.get serve do espelho sem ir ao banco", async () => {
    const whatsapp = makeWhatsapp(30);
    const { state } = await authState(whatsapp);

    const result = await state.keys.get("session", ["1:a", "1:b"]);

    expect(result).toEqual({ "1:a": { v: 1 } });
    expect(getEntries).not.toHaveBeenCalled();
  });
});

describe("authState — modo json permanece o padrao", () => {
  it("modo desconhecido cai no legado e nao toca o repositorio", async () => {
    mode.mockReturnValue("json");
    const whatsapp = makeWhatsapp(31);
    const { saveState } = await authState(whatsapp);

    await saveState();

    expect(whatsapp.update).toHaveBeenCalledWith({
      session: expect.any(String)
    });
    expect(setEntries).not.toHaveBeenCalled();
    expect(loadSnapshot).not.toHaveBeenCalled();
  });
});
