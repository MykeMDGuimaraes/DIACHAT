import AppError from "../../../../errors/AppError";
import { UnknownSendError } from "../../../contracts/ProviderSendError";
import { classifyMetaSendError } from "../MetaCloudMessageCommandProvider";
import { MetaGraphTransportError } from "../MetaGraphApiClient";

describe("classifyMetaSendError", () => {
  it("classifies pre-transmission network failures as retryable", () => {
    const error = classifyMetaSendError(
      new MetaGraphTransportError({
        message: "DNS falhou",
        phase: "before_transmission",
        cause: "ENOTFOUND"
      })
    );
    expect(error.classification).toBe("retryable");
    expect(error.code).toBe("META_NETWORK_BEFORE_TRANSMISSION");
  });

  it("classifies 429 as retryable with Retry-After in seconds", () => {
    const error = classifyMetaSendError(
      new MetaGraphTransportError({
        message: "429",
        phase: "response",
        statusCode: 429,
        retryAfterHeader: "30"
      })
    );
    expect(error.classification).toBe("retryable");
    expect(error.code).toBe("META_RATE_LIMITED");
    expect(error.retryAfterMs).toBe(30_000);
  });

  it("classifies 5xx and is_transient as retryable", () => {
    expect(
      classifyMetaSendError(
        new MetaGraphTransportError({
          message: "500",
          phase: "response",
          statusCode: 500
        })
      ).classification
    ).toBe("retryable");
    expect(
      classifyMetaSendError(
        new MetaGraphTransportError({
          message: "400 transient",
          phase: "response",
          statusCode: 400,
          errorBody: { error: { is_transient: true } }
        })
      ).classification
    ).toBe("retryable");
  });

  it("classifies deterministic 4xx as permanent", () => {
    const error = classifyMetaSendError(
      new MetaGraphTransportError({
        message: "400",
        phase: "response",
        statusCode: 400,
        errorBody: { error: { code: 100, message: "Invalid parameter" } }
      })
    );
    expect(error.classification).toBe("permanent");
    expect(error.providerStatus).toBe(400);
  });

  it("classifies WABA rate limit (code 80007) as retryable", () => {
    const error = classifyMetaSendError(
      new MetaGraphTransportError({
        message: "400 throttle",
        phase: "response",
        statusCode: 400,
        errorBody: { error: { code: 80007 } }
      })
    );
    expect(error.classification).toBe("retryable");
  });

  it("classifies post-transmission timeouts and unreadable 2xx as unknown", () => {
    expect(
      classifyMetaSendError(
        new MetaGraphTransportError({
          message: "timeout",
          phase: "after_transmission",
          cause: "ETIMEDOUT"
        })
      ).classification
    ).toBe("unknown");
  });

  it("parses Retry-After as an HTTP date", () => {
    const error = classifyMetaSendError(
      new MetaGraphTransportError({
        message: "429",
        phase: "response",
        statusCode: 429,
        retryAfterHeader: new Date(Date.now() + 90_000).toUTCString()
      })
    );
    expect(error.retryAfterMs).toBeGreaterThan(0);
    expect(error.retryAfterMs).toBeLessThanOrEqual(90_000);
  });

  it("classifies local validation AppErrors as permanent", () => {
    const error = classifyMetaSendError(new AppError("payload invalido", 400));
    expect(error.classification).toBe("permanent");
    expect(error.code).toBe("META_VALIDATION_FAILED");
  });

  it("passes through already-classified errors and defaults the rest to unknown", () => {
    const unknown = new UnknownSendError({ code: "X", message: "y" });
    expect(classifyMetaSendError(unknown)).toBe(unknown);
    expect(classifyMetaSendError(new Error("boom")).classification).toBe(
      "unknown"
    );
  });
});
