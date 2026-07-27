import {
  signWebhookPayload,
  verifyWebhookSignature
} from "../WebhookSignature";

describe("WebhookSignature", () => {
  const secret = "webhook-secret";
  const timestamp = "1721822400";
  const rawBody = '{"id":"evt_1"}';

  it("signs and verifies the exact timestamp.rawBody value", () => {
    const signature = signWebhookPayload(secret, timestamp, rawBody);

    expect(signature).toMatch(/^sha256=/);
    expect(
      verifyWebhookSignature(secret, timestamp, rawBody, signature)
    ).toBe(true);
  });

  it("rejects a signature when the body changes", () => {
    const signature = signWebhookPayload(secret, timestamp, rawBody);

    expect(
      verifyWebhookSignature(secret, timestamp, '{"id":"evt_2"}', signature)
    ).toBe(false);
  });
});
