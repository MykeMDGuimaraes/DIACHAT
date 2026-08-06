import { enqueueAuthStateWrite } from "../authStateWriter";
import {
  resetDeliveryMetrics,
  snapshotDeliveryMetrics
} from "../../messaging/public/observability";
import { logger } from "../../utils/logger";

jest.mock("../../utils/logger", () => ({
  logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

const loggerMock = logger as unknown as { error: jest.Mock };

describe("authStateWriter: telemetria (T7)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetDeliveryMetrics();
  });

  it("falha de escrita de credencial incrementa auth_write_failure_total", async () => {
    const persist = jest.fn().mockRejectedValue(new Error("db down"));

    await enqueueAuthStateWrite({
      whatsappId: 1,
      shouldWrite: () => true,
      persist
    }).catch(() => undefined);

    const snap = snapshotDeliveryMetrics();
    expect(snap.counters['auth_write_failure_total|{"whatsappId":1}']).toBe(1);
  });

  it("revisões crescentes aplicadas em ordem não disparam alerta de escrita stale", async () => {
    const persist = jest.fn().mockResolvedValue(undefined);

    await enqueueAuthStateWrite({
      whatsappId: 2,
      shouldWrite: () => true,
      persist
    });
    await enqueueAuthStateWrite({
      whatsappId: 2,
      shouldWrite: () => true,
      persist
    });

    expect(persist).toHaveBeenCalledTimes(2);
    // Sem alerta crítico de escrita stale aceita no caminho normal.
    expect(loggerMock.error).not.toHaveBeenCalledWith(
      expect.objectContaining({ alert: "stale_write_accepted" }),
      expect.anything()
    );
  });
});
