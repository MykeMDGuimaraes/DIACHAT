import { createHealthHandlers } from "../HealthController";

const responseRecorder = () => {
  const record = { statusCode: 200, payload: undefined as unknown };
  const response = {
    status(code: number) {
      record.statusCode = code;
      return response;
    },
    json(payload: unknown) {
      record.payload = payload;
      return response;
    }
  };
  return { record, response: response as any };
};

describe("HealthController", () => {
  it("reports liveness without depending on PostgreSQL or Redis", async () => {
    const handlers = createHealthHandlers({
      checkDatabase: async () => {
        throw new Error("must not run");
      },
      checkRedis: async () => {
        throw new Error("must not run");
      }
    });
    const { record, response } = responseRecorder();

    await handlers.live({} as any, response);

    expect(record).toEqual({
      statusCode: 200,
      payload: { status: "ok", service: "diachat-backend" }
    });
  });

  it("reports readiness only when PostgreSQL and Redis respond", async () => {
    const handlers = createHealthHandlers({
      checkDatabase: async () => undefined,
      checkRedis: async () => "PONG"
    });
    const { record, response } = responseRecorder();

    await handlers.ready({} as any, response);

    expect(record).toEqual({
      statusCode: 200,
      payload: {
        status: "ready",
        checks: { database: "up", redis: "up" }
      }
    });
  });

  it("returns 503 without leaking dependency errors", async () => {
    const handlers = createHealthHandlers({
      checkDatabase: async () => {
        throw new Error("postgresql://user:secret@private-host/database");
      },
      checkRedis: async () => "PONG"
    });
    const { record, response } = responseRecorder();

    await handlers.ready({} as any, response);

    expect(record).toEqual({
      statusCode: 503,
      payload: {
        status: "not_ready",
        checks: { database: "down", redis: "up" }
      }
    });
    expect(JSON.stringify(record.payload)).not.toContain("secret");
    expect(JSON.stringify(record.payload)).not.toContain("private-host");
  });
});
