import pino from "pino";

// Redação global (Hardening T7): estes campos NUNCA aparecem em log —
// telefone, jid, corpo de mensagem, QR, sessão, credenciais/chaves de
// pareamento e payload cifrado. Aplicado na raiz e até dois níveis de
// profundidade (objetos aninhados como { message: { body } }).
const SENSITIVE_LOG_KEYS = [
  "phone",
  "jid",
  "body",
  "qr",
  "session",
  "creds",
  "keys",
  "payloadEncrypted"
];

export const LOGGER_REDACT_PATHS = SENSITIVE_LOG_KEYS.flatMap(key => [
  key,
  `*.${key}`,
  `*.*.${key}`
]);

export const LOGGER_REDACT_CENSOR = "[redacted]";

const SENSITIVE_LOG_KEY_SET = new Set(SENSITIVE_LOG_KEYS);
const MAX_REDACT_DEPTH = 25;
const CIRCULAR_PLACEHOLDER = "[circular]";

/**
 * Redação recursiva (T7): cobre QUALQUER profundidade — os paths do pino
 * só alcançam dois níveis. Aplicada via formatters.log sobre o objeto final
 * do log; erros serializados (err -> { type, message, stack }) passam pelo
 * mesmo filtro.
 */
export const deepRedactSensitiveFields = <T>(value: T): T => {
  const seen = new WeakSet<object>();
  const walk = (input: unknown, depth: number): unknown => {
    if (input === null || typeof input !== "object") return input;
    if (depth > MAX_REDACT_DEPTH) return input;
    if (
      input instanceof Date ||
      Buffer.isBuffer(input) ||
      input instanceof RegExp
    ) {
      return input;
    }
    if (seen.has(input)) return CIRCULAR_PLACEHOLDER;
    seen.add(input);
    if (Array.isArray(input)) {
      return input.map(item => walk(item, depth + 1));
    }
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(
      input as Record<string, unknown>
    )) {
      output[key] = SENSITIVE_LOG_KEY_SET.has(key)
        ? LOGGER_REDACT_CENSOR
        : walk(nested, depth + 1);
    }
    return output;
  };
  return walk(value, 0) as T;
};

const logger = pino({
  redact: { paths: LOGGER_REDACT_PATHS, censor: LOGGER_REDACT_CENSOR },
  formatters: {
    log: object => deepRedactSensitiveFields(object)
  },
  // Em teste, sem transport worker-thread: saída JSON simples e o spec de
  // redação importa o módulo sem custo de thread.
  ...(process.env.NODE_ENV === "test"
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            levelFirst: true,
            translateTime: true,
            colorize: true
          }
        }
      })
});

export { logger };
