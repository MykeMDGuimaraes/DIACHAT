export interface ProductionEnvironment {
  [name: string]: string | undefined;
  NODE_ENV?: string;
  DATABASE_URL?: string;
  BACKEND_URL?: string;
  FRONTEND_URL?: string;
  JWT_SECRET?: string;
  JWT_REFRESH_SECRET?: string;
  API_KEY_PEPPER?: string;
  MESSAGING_WEBHOOK_VERIFY_TOKEN_PEPPER?: string;
  MESSAGING_ENCRYPTION_ACTIVE_KEY_ID?: string;
  META_GRAPH_VERSION?: string;
  RUN_SEEDS?: string;
  PRODUCTION_SEED_CONFIRMATION?: string;
}

export interface ProductionEnvironmentSummary {
  nodeEnv: string;
  databaseHost: string;
  backendOrigin: string;
  activeEncryptionKeyId: string;
  metaGraphVersion: string;
  sslRequired: boolean;
}

const REQUIRED_VARIABLES = [
  "NODE_ENV",
  "DATABASE_URL",
  "BACKEND_URL",
  "FRONTEND_URL",
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "API_KEY_PEPPER",
  "MESSAGING_WEBHOOK_VERIFY_TOKEN_PEPPER",
  "MESSAGING_ENCRYPTION_ACTIVE_KEY_ID",
  "META_GRAPH_VERSION"
] as const;

const requireValue = (
  environment: ProductionEnvironment,
  variable: (typeof REQUIRED_VARIABLES)[number]
): string => {
  const value = environment[variable]?.trim();
  if (!value) throw new Error(`DEPLOY_PREFLIGHT_MISSING: ${variable}`);
  return value;
};

const validateHttpsOrigin = (name: string, value: string): URL => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`DEPLOY_PREFLIGHT_INVALID: ${name}`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`DEPLOY_PREFLIGHT_INVALID: ${name}`);
  }
  return parsed;
};

const validateSecretLength = (name: string, value: string): void => {
  if (Buffer.byteLength(value, "utf8") < 32) {
    throw new Error(`DEPLOY_PREFLIGHT_INVALID: ${name}`);
  }
};

const decodeEncryptionKey = (encoded: string): Buffer => {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new Error("DEPLOY_PREFLIGHT_INVALID_ENCRYPTION_KEY");
  }
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== encoded) {
    throw new Error("DEPLOY_PREFLIGHT_INVALID_ENCRYPTION_KEY");
  }
  return decoded;
};

export const validateProductionEnvironment = (
  environment: ProductionEnvironment
): ProductionEnvironmentSummary => {
  const values = Object.fromEntries(
    REQUIRED_VARIABLES.map(name => [name, requireValue(environment, name)])
  ) as Record<(typeof REQUIRED_VARIABLES)[number], string>;

  if (values.NODE_ENV !== "production") {
    throw new Error("DEPLOY_PREFLIGHT_INVALID: NODE_ENV");
  }

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(values.DATABASE_URL);
  } catch {
    throw new Error("DEPLOY_PREFLIGHT_INVALID: DATABASE_URL");
  }
  if (
    !["postgres:", "postgresql:"].includes(databaseUrl.protocol) ||
    !databaseUrl.hostname ||
    !databaseUrl.username ||
    !databaseUrl.password ||
    databaseUrl.pathname === "/"
  ) {
    throw new Error("DEPLOY_PREFLIGHT_INVALID: DATABASE_URL");
  }
  const sslRequired =
    databaseUrl.searchParams.get("sslmode") === "require" ||
    environment.DB_SSL === "true";
  if (!sslRequired) {
    throw new Error("DEPLOY_PREFLIGHT_DATABASE_SSL_REQUIRED");
  }

  const backendUrl = validateHttpsOrigin("BACKEND_URL", values.BACKEND_URL);
  validateHttpsOrigin("FRONTEND_URL", values.FRONTEND_URL);

  validateSecretLength("JWT_SECRET", values.JWT_SECRET);
  validateSecretLength("JWT_REFRESH_SECRET", values.JWT_REFRESH_SECRET);
  validateSecretLength("API_KEY_PEPPER", values.API_KEY_PEPPER);
  validateSecretLength(
    "MESSAGING_WEBHOOK_VERIFY_TOKEN_PEPPER",
    values.MESSAGING_WEBHOOK_VERIFY_TOKEN_PEPPER
  );
  if (values.JWT_SECRET === values.JWT_REFRESH_SECRET) {
    throw new Error("DEPLOY_PREFLIGHT_JWT_SECRETS_MUST_DIFFER");
  }

  if (
    !/^[A-Za-z0-9_-]{1,32}$/.test(values.MESSAGING_ENCRYPTION_ACTIVE_KEY_ID)
  ) {
    throw new Error(
      "DEPLOY_PREFLIGHT_INVALID: MESSAGING_ENCRYPTION_ACTIVE_KEY_ID"
    );
  }
  const activeKeyVariable = `MESSAGING_ENCRYPTION_KEY_${values.MESSAGING_ENCRYPTION_ACTIVE_KEY_ID.toUpperCase()}`;
  const activeKey = Object.entries(environment)
    .find(([name]) => name.toUpperCase() === activeKeyVariable)?.[1]
    ?.trim();
  if (!activeKey) {
    throw new Error(`DEPLOY_PREFLIGHT_MISSING: ${activeKeyVariable}`);
  }
  decodeEncryptionKey(activeKey);

  if (!/^v[1-9][0-9]*\.[0-9]+$/.test(values.META_GRAPH_VERSION)) {
    throw new Error("DEPLOY_PREFLIGHT_INVALID: META_GRAPH_VERSION");
  }

  if (
    environment.RUN_SEEDS === "true" &&
    environment.PRODUCTION_SEED_CONFIRMATION !== "I_UNDERSTAND"
  ) {
    throw new Error("DEPLOY_PREFLIGHT_SEEDS_NOT_CONFIRMED");
  }

  return {
    nodeEnv: values.NODE_ENV,
    databaseHost: databaseUrl.hostname,
    backendOrigin: backendUrl.origin,
    activeEncryptionKeyId: values.MESSAGING_ENCRYPTION_ACTIVE_KEY_ID,
    metaGraphVersion: values.META_GRAPH_VERSION,
    sslRequired
  };
};

if (require.main === module) {
  try {
    const summary = validateProductionEnvironment(process.env);
    process.stdout.write(
      `${JSON.stringify({ status: "ready", ...summary })}\n`
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "DEPLOY_PREFLIGHT_FAILED"}\n`
    );
    process.exitCode = 1;
  }
}
