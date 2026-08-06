import { Writable } from "stream";
import pino from "pino";
import {
  deepRedactSensitiveFields,
  LOGGER_REDACT_CENSOR,
  LOGGER_REDACT_PATHS
} from "../logger";

/**
 * Redação global do logger (Hardening T7): phone, jid, body, qr, session,
 * creds, keys e payloadEncrypted nunca aparecem em log — na raiz e aninhados.
 */
const capture = (write: (log: pino.Logger) => void): Record<string, any> => {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    }
  });
  const log = pino(
    {
      redact: { paths: LOGGER_REDACT_PATHS, censor: LOGGER_REDACT_CENSOR },
      formatters: { log: deepRedactSensitiveFields }
    },
    stream
  );
  write(log);
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]);
};

describe("logger: redação de campos sensíveis (T7)", () => {
  it("redige os 8 campos sensíveis na raiz do payload", () => {
    const secret = "segredo-invisivel-5511999999999";
    const parsed = capture(log =>
      log.warn({
        phone: secret,
        jid: secret,
        body: secret,
        qr: secret,
        session: secret,
        creds: { noise: secret },
        keys: { preKey: secret },
        payloadEncrypted: secret,
        whatsappId: 42
      })
    );

    expect(JSON.stringify(parsed)).not.toContain(secret);
    expect(parsed.phone).toBe(LOGGER_REDACT_CENSOR);
    expect(parsed.jid).toBe(LOGGER_REDACT_CENSOR);
    expect(parsed.body).toBe(LOGGER_REDACT_CENSOR);
    expect(parsed.qr).toBe(LOGGER_REDACT_CENSOR);
    expect(parsed.session).toBe(LOGGER_REDACT_CENSOR);
    expect(parsed.creds).toBe(LOGGER_REDACT_CENSOR);
    expect(parsed.keys).toBe(LOGGER_REDACT_CENSOR);
    expect(parsed.payloadEncrypted).toBe(LOGGER_REDACT_CENSOR);
    expect(parsed.whatsappId).toBe(42);
  });

  it("redige campos sensíveis aninhados em um e dois níveis", () => {
    const secret = "corpo-da-mensagem-abc123";
    const parsed = capture(log =>
      log.warn({
        message: { body: secret, phone: "5511999" },
        outer: { inner: { jid: secret } },
        whatsappId: 7
      })
    );

    expect(JSON.stringify(parsed)).not.toContain(secret);
    expect(parsed.message.body).toBe(LOGGER_REDACT_CENSOR);
    expect(parsed.message.phone).toBe(LOGGER_REDACT_CENSOR);
    expect(parsed.outer.inner.jid).toBe(LOGGER_REDACT_CENSOR);
    expect(parsed.whatsappId).toBe(7);
  });
});

describe("logger: redação em profundidade arbitrária (T7)", () => {
  it("redige campos sensíveis além de dois níveis de aninhamento", () => {
    const secret = "profundo-demais-5511999";
    const parsed = capture(log =>
      log.warn({
        level1: {
          level2: {
            level3: { level4: { body: secret, creds: { token: secret } } }
          }
        },
        whatsappId: 3
      })
    );

    expect(JSON.stringify(parsed)).not.toContain(secret);
    expect(parsed.level1.level2.level3.level4.body).toBe(LOGGER_REDACT_CENSOR);
    expect(parsed.level1.level2.level3.level4.creds).toBe(LOGGER_REDACT_CENSOR);
    expect(parsed.whatsappId).toBe(3);
  });

  it("redige campos sensíveis dentro de arrays e sobrevive a ciclos", () => {
    const secret = "segredo-em-array-123";
    const cyclic: Record<string, unknown> = { phone: secret };
    cyclic.self = cyclic;
    const parsed = capture(log =>
      log.warn({ items: [{ jid: secret }, { body: secret }], cyclic })
    );

    expect(JSON.stringify(parsed)).not.toContain(secret);
    expect(parsed.items[0].jid).toBe(LOGGER_REDACT_CENSOR);
    expect(parsed.items[1].body).toBe(LOGGER_REDACT_CENSOR);
    expect(parsed.cyclic.phone).toBe(LOGGER_REDACT_CENSOR);
    expect(parsed.cyclic.self).toBe("[circular]");
  });
});
