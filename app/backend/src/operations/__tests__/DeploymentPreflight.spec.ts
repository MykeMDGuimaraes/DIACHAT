import {
  validateProductionEnvironment,
  ProductionEnvironment
} from "../DeploymentPreflight";

const validEnvironment = (): ProductionEnvironment => ({
  NODE_ENV: "production",
  DATABASE_URL:
    "postgresql://diachat:secret@database.example.com:5432/diachat?sslmode=require",
  BACKEND_URL: "https://chat.diasolutions.com.br",
  FRONTEND_URL: "https://chat.diasolutions.com.br",
  JWT_SECRET: "jwt-secret-with-at-least-thirty-two-bytes",
  JWT_REFRESH_SECRET: "refresh-secret-with-at-least-thirty-two-bytes",
  API_KEY_PEPPER: "api-key-pepper-with-at-least-32-bytes",
  MESSAGING_WEBHOOK_VERIFY_TOKEN_PEPPER:
    "webhook-pepper-with-at-least-32-bytes",
  MESSAGING_ENCRYPTION_ACTIVE_KEY_ID: "v1",
  MESSAGING_ENCRYPTION_KEY_V1: Buffer.alloc(32, "k").toString("base64"),
  META_GRAPH_VERSION: "v23.0"
});

describe("DeploymentPreflight", () => {
  it("accepts a complete production environment without exposing secrets", () => {
    const environment = validEnvironment();

    const summary = validateProductionEnvironment(environment);

    expect(summary).toEqual({
      nodeEnv: "production",
      databaseHost: "database.example.com",
      backendOrigin: "https://chat.diasolutions.com.br",
      activeEncryptionKeyId: "v1",
      metaGraphVersion: "v23.0",
      sslRequired: true
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain(environment.DATABASE_URL);
    expect(serialized).not.toContain(environment.JWT_SECRET);
    expect(serialized).not.toContain(environment.MESSAGING_ENCRYPTION_KEY_V1);
  });

  it.each([
    "DATABASE_URL",
    "BACKEND_URL",
    "FRONTEND_URL",
    "JWT_SECRET",
    "JWT_REFRESH_SECRET",
    "API_KEY_PEPPER",
    "MESSAGING_WEBHOOK_VERIFY_TOKEN_PEPPER",
    "MESSAGING_ENCRYPTION_ACTIVE_KEY_ID",
    "META_GRAPH_VERSION"
  ] as const)("rejects a missing %s before migrations start", variable => {
    const environment = validEnvironment();
    delete environment[variable];

    expect(() => validateProductionEnvironment(environment)).toThrow(
      `DEPLOY_PREFLIGHT_MISSING: ${variable}`
    );
  });

  it("requires the active encryption key to decode to exactly 32 bytes", () => {
    const environment = validEnvironment();
    environment.MESSAGING_ENCRYPTION_KEY_V1 =
      Buffer.alloc(31).toString("base64");

    expect(() => validateProductionEnvironment(environment)).toThrow(
      "DEPLOY_PREFLIGHT_INVALID_ENCRYPTION_KEY"
    );
  });

  it.each([
    ["DATABASE_URL", "mysql://user:pass@database.example.com/diachat"],
    ["BACKEND_URL", "http://chat.diasolutions.com.br"],
    ["META_GRAPH_VERSION", "latest"]
  ] as const)("rejects unsafe %s values", (variable, value) => {
    const environment = validEnvironment();
    environment[variable] = value;

    expect(() => validateProductionEnvironment(environment)).toThrow(
      "DEPLOY_PREFLIGHT_INVALID"
    );
  });

  it("rejects reused JWT secrets", () => {
    const environment = validEnvironment();
    environment.JWT_REFRESH_SECRET = environment.JWT_SECRET;

    expect(() => validateProductionEnvironment(environment)).toThrow(
      "DEPLOY_PREFLIGHT_JWT_SECRETS_MUST_DIFFER"
    );
  });

  it("requires encrypted PostgreSQL transport", () => {
    const environment = validEnvironment();
    environment.DATABASE_URL =
      "postgresql://diachat:secret@database.example.com:5432/diachat";

    expect(() => validateProductionEnvironment(environment)).toThrow(
      "DEPLOY_PREFLIGHT_DATABASE_SSL_REQUIRED"
    );

    environment.DB_SSL = "true";
    expect(() => validateProductionEnvironment(environment)).not.toThrow();
  });

  it("requires an explicit confirmation before production seeds", () => {
    const environment = validEnvironment();
    environment.RUN_SEEDS = "true";

    expect(() => validateProductionEnvironment(environment)).toThrow(
      "DEPLOY_PREFLIGHT_SEEDS_NOT_CONFIRMED"
    );

    environment.PRODUCTION_SEED_CONFIRMATION = "I_UNDERSTAND";
    expect(() => validateProductionEnvironment(environment)).not.toThrow();
  });
});
