import {
  signWebhookMediaUrl,
  verifyWebhookMediaToken,
  WEBHOOK_MEDIA_TTL_SECONDS
} from "../WebhookMediaToken";

const keyring = {
  activeKeyId: "v2",
  keys: {
    v1: Buffer.alloc(32, 1).toString("base64"),
    v2: Buffer.alloc(32, 2).toString("base64")
  }
};
const now = new Date("2026-07-29T12:00:00.000Z");

describe("WebhookMediaToken", () => {
  it("signs a seven-day URL with the active messaging key version and verifies only the bound company/message/version/expiry tuple", () => {
    const url = new URL(
      signWebhookMediaUrl("message/with spaces", 7, now, keyring),
      "https://dia-chat.invalid"
    );
    const expires = Number(url.searchParams.get("expires"));
    const keyVersion = url.searchParams.get("keyVersion") || "";
    const token = url.searchParams.get("sig") || "";

    expect(url.pathname).toBe(
      "/api/v1/webhook-media/message%2Fwith%20spaces"
    );
    expect(expires).toBe(
      Math.floor(now.getTime() / 1000) + WEBHOOK_MEDIA_TTL_SECONDS
    );
    expect(keyVersion).toBe("v2");
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(
      verifyWebhookMediaToken({
        messageId: "message/with spaces",
        companyId: 7,
        expires,
        keyVersion,
        token,
        now,
        keyring
      })
    ).toBe(true);

    for (const override of [
      { messageId: "other-message" },
      { companyId: 8 },
      { expires: expires - 1 },
      { keyVersion: "v1" }
    ]) {
      expect(
        verifyWebhookMediaToken({
          messageId: "message/with spaces",
          companyId: 7,
          expires,
          keyVersion,
          token,
          now,
          keyring,
          ...override
        })
      ).toBe(false);
    }
    expect(
      verifyWebhookMediaToken({
        messageId: "message/with spaces",
        companyId: 7,
        expires,
        keyVersion,
        token,
        now: new Date((expires + 1) * 1000),
        keyring
      })
    ).toBe(false);
  });
});
