import "../bootstrap";

let urlConfig: {
  host?: string;
  port?: string;
  database?: string;
  username?: string;
  password?: string;
  ssl?: boolean;
} = {};

if (process.env.DATABASE_URL) {
  try {
    const dbUrl = new URL(process.env.DATABASE_URL);
    urlConfig = {
      host: dbUrl.hostname,
      port: dbUrl.port || "5432",
      database: dbUrl.pathname.replace(/^\//, ""),
      username: decodeURIComponent(dbUrl.username),
      password: decodeURIComponent(dbUrl.password),
      ssl: dbUrl.searchParams.get("sslmode") === "require"
    };
  } catch (err) {
    console.error("[database] DATABASE_URL inválida, usando DB_* :", err);
  }
}

module.exports = {
  dialect: process.env.DB_DIALECT || "postgres",
  timezone: "-03:00",
  host: process.env.DB_HOST || urlConfig.host,
  port: process.env.DB_PORT || urlConfig.port || 5432,
  database: process.env.DB_NAME || urlConfig.database,
  username: process.env.DB_USER || urlConfig.username,
  password: process.env.DB_PASS || urlConfig.password,
  ...(process.env.DB_SSL === "true" || (urlConfig.ssl && !process.env.DB_HOST)
    ? { dialectOptions: { ssl: { require: true, rejectUnauthorized: false } } }
    : {}),
  logging:
    process.env.DB_DEBUG === "true"
      ? msg => console.log(`[Sequelize] ${new Date().toISOString()}: ${msg}`)
      : false,
  pool: {
    max: 20,
    min: 1,
    acquire: 0,
    idle: 30000,
    evict: 1000 * 60 * 5
  },
  retry: {
    max: 3,
    timeout: 30000,
    match: [
      /Deadlock/i,
      /SequelizeConnectionError/,
      /SequelizeConnectionRefusedError/,
      /SequelizeConnectionTimedOutError/,
      /SequelizeHostNotFoundError/,
      /SequelizeHostNotReachableError/,
      /SequelizeInvalidConnectionError/,
      /SequelizeConnectionAcquireTimeoutError/,
      /Operation timeout/,
      /ETIMEDOUT/
    ]
  }
};
