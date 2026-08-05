import Whatsapp from "../../../models/Whatsapp";
import { setSessionKeyEntries } from "../../persistence/WhatsAppSessionKeyRepository";
import {
  BACKFILL_FENCE,
  planSessionKeyBackfill
} from "../WhatsAppSessionKeyBackfill";
import { runWhatsAppSessionKeyBackfill } from "../WhatsAppSessionKeyBackfillCli";

jest.mock("../../adapters/baileys/BaileysExports", () => ({
  BufferJSON: { replacer: undefined, reviver: undefined }
}));

jest.mock("../../persistence/WhatsAppSessionKeyRepository", () => ({
  CREDS_KEY_TYPE: "creds",
  CREDS_KEY_ID: "current",
  setSessionKeyEntries: jest.fn().mockResolvedValue(undefined)
}));

const VALID_SESSION = JSON.stringify({
  creds: { me: { id: "5511@s.whatsapp.net" }, segredo: "nao-logar" },
  keys: {
    sessions: { "1:a": { v: 1 }, "1:b": null },
    preKeys: { "9": { v: 2 } }
  }
});

const setArgv = (extras: string[]) => {
  process.argv = [...process.argv.slice(0, 2), ...extras];
};

const originalArgv = process.argv;

afterEach(() => {
  process.argv = originalArgv;
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("planSessionKeyBackfill", () => {
  it("sessao ausente ou vazia e pulada como empty", () => {
    expect(planSessionKeyBackfill(null).status).toBe("empty");
    expect(planSessionKeyBackfill("").status).toBe("empty");
  });

  it("JSON corrompido e invalido", () => {
    expect(planSessionKeyBackfill("{nao-json").status).toBe("invalid");
  });

  it("sessao sem creds.me.id (nao pareada) e invalida", () => {
    expect(
      planSessionKeyBackfill(JSON.stringify({ creds: {}, keys: {} })).status
    ).toBe("invalid");
    expect(
      planSessionKeyBackfill(JSON.stringify({ creds: { me: {} }, keys: {} }))
        .status
    ).toBe("invalid");
  });

  it("sessao valida vira creds + entradas por chave, sem tombstones", () => {
    const plan = planSessionKeyBackfill(VALID_SESSION);

    expect(plan.status).toBe("ready");
    // creds + 1 session (a tombstone "1:b" nao migra) + 1 pre-key.
    expect(plan.entries).toHaveLength(3);
    expect(plan.entries[0]).toMatchObject({
      keyType: "creds",
      keyId: "current"
    });
    expect(plan.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ keyType: "session", keyId: "1:a" }),
        expect.objectContaining({ keyType: "pre-key", keyId: "9" })
      ])
    );
    expect(plan.entries.find(entry => entry.keyId === "1:b")).toBeUndefined();
  });
});

describe("runWhatsAppSessionKeyBackfill", () => {
  it("dry-run valida e conta sem gravar nada", async () => {
    setArgv([]);
    jest
      .spyOn(Whatsapp, "findAll")
      .mockResolvedValueOnce([
        { id: 1, session: VALID_SESSION },
        { id: 2, session: "" },
        { id: 3, session: "{corrompido" }
      ] as any)
      .mockResolvedValueOnce([]);

    const summary = await runWhatsAppSessionKeyBackfill();

    expect(summary).toMatchObject({
      scanned: 3,
      ready: 1,
      empty: 1,
      invalid: 1,
      upserted: 0,
      lastWhatsappId: 3
    });
    expect(setSessionKeyEntries).not.toHaveBeenCalled();
  });

  it("apply grava com o fence de backfill e conta os upserts", async () => {
    setArgv(["--apply"]);
    jest
      .spyOn(Whatsapp, "findAll")
      .mockResolvedValueOnce([{ id: 1, session: VALID_SESSION }] as any)
      .mockResolvedValueOnce([]);

    const summary = await runWhatsAppSessionKeyBackfill();

    expect(summary.upserted).toBe(1);
    expect(setSessionKeyEntries).toHaveBeenCalledTimes(1);
    const call = (setSessionKeyEntries as jest.Mock).mock.calls[0][0];
    expect(call.whatsappId).toBe(1);
    expect(call.fence).toEqual(BACKFILL_FENCE);
    expect(call.entries).toHaveLength(3);
  });

  it("a saida contem apenas contagens — nunca payload da sessao", async () => {
    setArgv(["--apply"]);
    jest
      .spyOn(Whatsapp, "findAll")
      .mockResolvedValueOnce([{ id: 1, session: VALID_SESSION }] as any)
      .mockResolvedValueOnce([]);
    const writes: string[] = [];
    jest.spyOn(process.stdout, "write").mockImplementation(((chunk: any) => {
      writes.push(String(chunk));
      return true;
    }) as any);

    await runWhatsAppSessionKeyBackfill();

    const output = writes.join("");
    expect(output).toContain('"scanned":1');
    expect(output).not.toContain("segredo");
    expect(output).not.toContain("s.whatsapp.net");
    expect(output).not.toContain(VALID_SESSION);
  });
});
