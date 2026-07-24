import {
  decryptMessagingSecret,
  encryptMessagingSecret,
  loadMessagingKeyring,
  MessagingKeyring
} from "../MessagingSecretCipher";

const key = (seed: string): string =>
  Buffer.from(seed.repeat(32).slice(0, 32)).toString("base64");

describe("MessagingSecretCipher", () => {
  it("encrypts with the active key and decrypts a secret", () => {
    const keyring: MessagingKeyring = {
      activeKeyId: "v2",
      keys: { v1: key("a"), v2: key("b") }
    };

    const encrypted = encryptMessagingSecret("access-token", keyring);

    expect(encrypted).toMatch(
      /^v2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
    );
    expect(decryptMessagingSecret(encrypted, keyring)).toBe("access-token");
  });

  it("keeps decrypting a secret written with a previous key version", () => {
    const oldKeyring: MessagingKeyring = {
      activeKeyId: "v1",
      keys: { v1: key("a"), v2: key("b") }
    };
    const encrypted = encryptMessagingSecret("app-secret", oldKeyring);
    const rotatedKeyring: MessagingKeyring = {
      activeKeyId: "v2",
      keys: { v1: key("a"), v2: key("b") }
    };

    expect(decryptMessagingSecret(encrypted, rotatedKeyring)).toBe(
      "app-secret"
    );
  });

  it("rejects a modified ciphertext", () => {
    const keyring: MessagingKeyring = {
      activeKeyId: "v1",
      keys: { v1: key("a") }
    };
    const encrypted = encryptMessagingSecret("token", keyring);
    const modified = `${encrypted.slice(0, -1)}x`;

    expect(() => decryptMessagingSecret(modified, keyring)).toThrow(
      "Segredo de mensageria inválido"
    );
  });

  it("loads a versioned keyring from environment variables", () => {
    expect(
      loadMessagingKeyring({
        MESSAGING_ENCRYPTION_ACTIVE_KEY_ID: "v2",
        MESSAGING_ENCRYPTION_KEY_V1: key("a"),
        MESSAGING_ENCRYPTION_KEY_V2: key("b")
      })
    ).toEqual({
      activeKeyId: "v2",
      keys: { v1: key("a"), v2: key("b") }
    });
  });

  it("fails startup configuration when the active key is absent", () => {
    expect(() =>
      loadMessagingKeyring({ MESSAGING_ENCRYPTION_ACTIVE_KEY_ID: "v2" })
    ).toThrow("Keyring de mensageria inválido");
  });
});
