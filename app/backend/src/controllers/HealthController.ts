import { Request, Response } from "express";

interface HealthDependencies {
  checkDatabase(): Promise<unknown>;
  checkRedis(): Promise<unknown>;
}

const defaultDependencies: HealthDependencies = {
  checkDatabase: () => {
    const sequelize = require("../database").default;
    return sequelize.authenticate();
  },
  checkRedis: () => {
    const { ping } = require("../libs/cache");
    return ping();
  }
};

export const createHealthHandlers = (
  dependencies: HealthDependencies = defaultDependencies
) => ({
  live: async (_req: Request, res: Response): Promise<Response> =>
    res.json({ status: "ok", service: "diachat-backend" }),

  ready: async (_req: Request, res: Response): Promise<Response> => {
    const [database, redis] = await Promise.allSettled([
      dependencies.checkDatabase(),
      dependencies.checkRedis()
    ]);
    const checks = {
      database: database.status === "fulfilled" ? "up" : "down",
      redis: redis.status === "fulfilled" ? "up" : "down"
    };
    const ready = checks.database === "up" && checks.redis === "up";
    return res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      checks
    });
  }
});

const healthHandlers = createHealthHandlers();

export const live = healthHandlers.live;
export const ready = healthHandlers.ready;
