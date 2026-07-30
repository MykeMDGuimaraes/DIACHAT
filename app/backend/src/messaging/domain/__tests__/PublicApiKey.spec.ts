import {
  hashApiKeySecret,
  parsePublicApiKey,
  verifyApiKeySecret
} from "../PublicApiKey";

describe("PublicApiKey", () => {
  const pepper = "server-pepper";

  it("parses the token identifier and secret from the public key format", () => {
    expect(
      parsePublicApiKey("dch_live_token_12345678.secret-value-12345678")
    ).toEqual({
      tokenId: "token_12345678",
      secret: "secret-value-12345678"
    });
  });

  it("verifies a secret against its peppered hash", () => {
    const hash = hashApiKeySecret("secret-value-12345678", pepper);

    expect(verifyApiKeySecret("secret-value-12345678", pepper, hash)).toBe(true);
    expect(verifyApiKeySecret("different-secret-12345678", pepper, hash)).toBe(false);
  });
});
