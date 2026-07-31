import AppError from "../../../errors/AppError";
import { requireMetaCloudPhase2 } from "../MetaCloudFeatureGate";

describe("requireMetaCloudPhase2", () => {
  const initial = process.env.MESSAGING_META_CLOUD_ENABLED;
  afterEach(() => { process.env.MESSAGING_META_CLOUD_ENABLED = initial; });

  it("hides Meta Cloud endpoints before Phase 2", () => {
    process.env.MESSAGING_META_CLOUD_ENABLED = "false";
    try {
      requireMetaCloudPhase2({} as any, {} as any, jest.fn());
      throw new Error("expected gate to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(404);
    }
  });

  it("allows the endpoint only when explicitly enabled", () => {
    process.env.MESSAGING_META_CLOUD_ENABLED = "true";
    const next = jest.fn();
    requireMetaCloudPhase2({} as any, {} as any, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
