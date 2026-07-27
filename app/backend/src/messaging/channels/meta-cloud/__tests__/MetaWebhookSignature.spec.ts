import { createHmac } from "crypto";
import { verifyMetaWebhookSignature } from "../MetaWebhookSignature";

describe("verifyMetaWebhookSignature", () => {
  it("accepts the exact raw Meta payload signed with the tenant app secret", () => {
    const rawBody = '{"object":"whatsapp_business_account"}';
    const signature = `sha256=${createHmac("sha256", "app-secret")
      .update(rawBody)
      .digest("hex")}`;

    expect(verifyMetaWebhookSignature("app-secret", rawBody, signature)).toBe(true);
  });

  it("rejects a signature for another payload", () => {
    expect(
      verifyMetaWebhookSignature("app-secret", "{}", "sha256=invalid")
    ).toBe(false);
  });
});
