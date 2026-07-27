import {
  createRequestFingerprint,
  validateIdempotencyKey
} from "../IdempotencyKey";

describe("IdempotencyKey", () => {
  it("rejects keys shorter than eight characters", () => {
    expect(() => validateIdempotencyKey("short")).toThrow(
      "Idempotency-Key deve ter entre 8 e 128 caracteres"
    );
  });

  it("creates the same fingerprint for equivalent object key order", () => {
    expect(
      createRequestFingerprint({ connectionId: "w_1", text: "Olá" })
    ).toBe(createRequestFingerprint({ text: "Olá", connectionId: "w_1" }));
  });
});
