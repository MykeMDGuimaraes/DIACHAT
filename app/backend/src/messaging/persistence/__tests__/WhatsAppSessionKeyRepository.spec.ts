import sequelize from "../../../database";
import {
  CREDS_KEY_ID,
  CREDS_KEY_TYPE,
  MAX_SESSION_KEY_PAYLOAD_BYTES,
  getSessionKeyEntries,
  loadSessionAuthSnapshot,
  resolveAuthStoreMode,
  sessionAuthDigest,
  setSessionKeyEntries
} from "../WhatsAppSessionKeyRepository";
import {
  decryptMessagingSecret,
  encryptMessagingSecret,
  MessagingKeyring
} from "../../security/MessagingSecretCipher";
import {
  resetDeliveryMetrics,
  snapshotDeliveryMetrics
} from "../../telemetry/DeliveryObservability";

jest.mock("../../adapters/baileys/BaileysExports", () => ({
  BufferJSON: { replacer: undefined, reviver: undefined }
}));

const keyring: MessagingKeyring = {
  activeKeyId: "v1",
  keys: { v1: Buffer.alloc(32, 7).toString("base64") }
};

const fence = { revision: 3, generation: 42 };

const mockTransaction = () =>
  jest
    .spyOn(sequelize, "transaction")
    .mockImplementation((async (callback: any) =>
      callback({})) as typeof sequelize.transaction);

afterEach(() => {
  jest.restoreAllMocks();
});

describe("WhatsAppSessionKeyRepository", () => {
  it("le somente os ids solicitados e decifra o payload", async () => {
    const ciphertext = encryptMessagingSecret(
      JSON.stringify({ pre: true }),
      keyring
    );
    const query = jest
      .spyOn(sequelize, "query")
      .mockResolvedValue([{ keyId: "1:abc", ciphertext }] as any);

    const result = await getSessionKeyEntries({
      whatsappId: 7,
      keyType: "session",
      keyIds: ["1:abc", "1:def"],
      keyring
    });

    expect(result).toEqual({ "1:abc": { pre: true } });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, options] = query.mock.calls[0] as any;
    expect(sql).toContain('"keyId" IN (:keyIds)');
    expect(options.replacements).toMatchObject({
      whatsappId: 7,
      keyType: "session",
      keyIds: ["1:abc", "1:def"]
    });
  });

  it("lista de ids vazia nem consulta o banco", async () => {
    const query = jest.spyOn(sequelize, "query");

    await expect(
      getSessionKeyEntries({
        whatsappId: 7,
        keyType: "session",
        keyIds: [],
        keyring
      })
    ).resolves.toEqual({});
    expect(query).not.toHaveBeenCalled();
  });

  it("grava somente os ids alterados, cifrados, nunca JSON em claro", async () => {
    mockTransaction();
    const query = jest.spyOn(sequelize, "query").mockResolvedValue([] as any);

    await setSessionKeyEntries({
      whatsappId: 7,
      entries: [
        { keyType: "session", keyId: "1:a", value: { segredo: "marcador-a" } },
        { keyType: "pre-key", keyId: "9", value: { segredo: "marcador-b" } }
      ],
      fence,
      keyring
    });

    // Uma instrucao por entrada alterada — nunca snapshot monolitico.
    expect(query).toHaveBeenCalledTimes(2);
    for (const [sql, options] of query.mock.calls as any[]) {
      expect(sql).toContain("ON CONFLICT");
      expect(options.replacements.revision).toBe(3);
      expect(options.replacements.generation).toBe(42);
      const { ciphertext } = options.replacements;
      // Formato do cipher de mensageria e NUNCA payload em claro.
      expect(ciphertext.startsWith("v1.")).toBe(true);
      expect(ciphertext).not.toContain("marcador");
      expect(ciphertext).not.toContain("segredo");
    }
    // Round-trip: o valor decifrado e exatamente o persistido.
    const first = (query.mock.calls[0] as any[])[1].replacements.ciphertext;
    expect(JSON.parse(decryptMessagingSecret(first, keyring))).toEqual({
      segredo: "marcador-a"
    });
  });

  it("toda escrita carrega fencing de revisao/geracao (upsert e delete)", async () => {
    mockTransaction();
    const query = jest.spyOn(sequelize, "query").mockResolvedValue([] as any);

    await setSessionKeyEntries({
      whatsappId: 7,
      entries: [
        { keyType: "session", keyId: "1:a", value: { v: 1 } },
        { keyType: "session", keyId: "1:b", value: null }
      ],
      fence,
      keyring
    });

    const [upsertSql] = query.mock.calls[0] as any[];
    const [deleteSql] = query.mock.calls[1] as any[];
    expect(upsertSql).toContain("ON CONFLICT");
    expect(upsertSql).toContain('"generation" < :generation');
    expect(upsertSql).toContain('"revision" <= :revision');
    expect(deleteSql).toContain("DELETE");
    expect(deleteSql).toContain('"generation" < :generation');
    expect(deleteSql).toContain('"revision" <= :revision');
  });

  it("tombstone remove a chave (delete fenced), sem upsert", async () => {
    mockTransaction();
    const query = jest.spyOn(sequelize, "query").mockResolvedValue([] as any);

    await setSessionKeyEntries({
      whatsappId: 7,
      entries: [{ keyType: "session", keyId: "1:a", value: null }],
      fence,
      keyring
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql] = query.mock.calls[0] as any[];
    expect(sql).toContain("DELETE");
    expect(sql).not.toContain("INSERT");
  });

  it("falha fechada: ciphertext invalido lanca erro (socket nao inicia)", async () => {
    jest.spyOn(sequelize, "query").mockResolvedValue([
      {
        keyType: CREDS_KEY_TYPE,
        keyId: CREDS_KEY_ID,
        ciphertext: "corrompido"
      }
    ] as any);

    await expect(
      loadSessionAuthSnapshot({ whatsappId: 7, keyring })
    ).rejects.toThrow();
  });

  it("falha fechada: chave de criptografia ausente do keyring lanca erro", async () => {
    const ciphertext = encryptMessagingSecret(
      JSON.stringify({ v: 1 }),
      keyring
    );
    jest
      .spyOn(sequelize, "query")
      .mockResolvedValue([{ keyId: "1:a", ciphertext }] as any);
    const otherKeyring: MessagingKeyring = {
      activeKeyId: "v2",
      keys: { v2: Buffer.alloc(32, 9).toString("base64") }
    };

    await expect(
      getSessionKeyEntries({
        whatsappId: 7,
        keyType: "session",
        keyIds: ["1:a"],
        keyring: otherKeyring
      })
    ).rejects.toThrow();
  });

  it("rejeita registro acima do limite de tamanho sem tocar o banco", async () => {
    mockTransaction();
    const query = jest.spyOn(sequelize, "query");

    await expect(
      setSessionKeyEntries({
        whatsappId: 7,
        entries: [
          {
            keyType: "session",
            keyId: "grande",
            value: { blob: "x".repeat(MAX_SESSION_KEY_PAYLOAD_BYTES) }
          }
        ],
        fence,
        keyring
      })
    ).rejects.toThrow("limite");
    expect(query).not.toHaveBeenCalled();
  });

  it("snapshot completo separa credenciais das chaves e conta registros", async () => {
    jest.spyOn(sequelize, "query").mockResolvedValue([
      {
        keyType: CREDS_KEY_TYPE,
        keyId: CREDS_KEY_ID,
        ciphertext: encryptMessagingSecret(
          JSON.stringify({ me: { id: "1" } }),
          keyring
        )
      },
      {
        keyType: "session",
        keyId: "1:a",
        ciphertext: encryptMessagingSecret(JSON.stringify({ v: 1 }), keyring)
      }
    ] as any);

    const snapshot = await loadSessionAuthSnapshot({ whatsappId: 7, keyring });

    expect(snapshot.creds).toEqual({ me: { id: "1" } });
    expect(snapshot.keys).toEqual({ session: { "1:a": { v: 1 } } });
    expect(snapshot.entryCount).toBe(2);
  });

  it("digest canonico ignora ordem e trata null como chave ausente", () => {
    expect(
      sessionAuthDigest({ creds: { a: 1 }, keys: { session: { "1": null } } })
    ).toBe(sessionAuthDigest({ creds: { a: 1 }, keys: { session: {} } }));
    expect(sessionAuthDigest({ creds: { b: 2, a: 1 }, keys: {} })).toBe(
      sessionAuthDigest({ creds: { a: 1, b: 2 }, keys: {} })
    );
    expect(sessionAuthDigest({ creds: { a: 1 }, keys: {} })).not.toBe(
      sessionAuthDigest({ creds: { a: 2 }, keys: {} })
    );
  });

  it("resolveAuthStoreMode: padrao json, modos novos e fallback seguro", () => {
    expect(resolveAuthStoreMode({})).toBe("json");
    expect(
      resolveAuthStoreMode({ MESSAGING_AUTH_STORE_MODE: "dual_write" })
    ).toBe("dual_write");
    expect(
      resolveAuthStoreMode({ MESSAGING_AUTH_STORE_MODE: "postgres" })
    ).toBe("postgres");
    expect(resolveAuthStoreMode({ MESSAGING_AUTH_STORE_MODE: "lixo" })).toBe(
      "json"
    );
  });
});

describe("telemetria (T7)", () => {
  beforeEach(() => resetDeliveryMetrics());

  it("fencing que rejeita a escrita conta auth_revision_conflict_total", async () => {
    mockTransaction();
    jest.spyOn(sequelize, "query").mockResolvedValue([] as any);

    await setSessionKeyEntries({
      whatsappId: 7,
      entries: [{ keyType: "session", keyId: "1:a", value: { v: 1 } }],
      fence,
      keyring
    });

    const snap = snapshotDeliveryMetrics();
    expect(snap.counters['auth_revision_conflict_total|{"whatsappId":7}']).toBe(
      1
    );
  });

  it("escrita aplicada retorna via RETURNING e nao conta conflito", async () => {
    mockTransaction();
    const query = jest
      .spyOn(sequelize, "query")
      .mockResolvedValue([{ keyId: "1:a" }] as any);

    await setSessionKeyEntries({
      whatsappId: 7,
      entries: [{ keyType: "session", keyId: "1:a", value: { v: 1 } }],
      fence,
      keyring
    });

    const [upsertSql] = query.mock.calls[0] as any[];
    expect(upsertSql).toContain('RETURNING "keyId"');
    expect(
      snapshotDeliveryMetrics().counters[
        'auth_revision_conflict_total|{"whatsappId":7}'
      ]
    ).toBeUndefined();
  });
});
