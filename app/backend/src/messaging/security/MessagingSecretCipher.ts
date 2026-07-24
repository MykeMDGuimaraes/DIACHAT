import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

export interface MessagingKeyring {
  activeKeyId: string;
  keys: Record<string, string>;
}

const invalidSecret = (): Error => new Error("Segredo de mensageria invÃ¡lido");
const invalidKeyring = (): Error => new Error("Keyring de mensageria invÃ¡lido");

export const loadMessagingKeyring = (
  environment: Record<string, string | undefined> = process.env
): MessagingKeyring => {
  const activeKeyId = environment.MESSAGING_ENCRYPTION_ACTIVE_KEY_ID;
  const keys = Object.entries(environment).reduce<Record<string, string>>(
    (current, [name, value]) => {
      const match = /^MESSAGING_ENCRYPTION_KEY_(.+)$/.exec(name);
      if (match && value) {
        current[match[1].toLowerCase()] = value;
      }
      return current;
    },
    {}
  );

  if (!activeKeyId || !keys[activeKeyId.toLowerCase()]) {
    throw invalidKeyring();
  }

  try {
    getKey(activeKeyId.toLowerCase(), { activeKeyId: activeKeyId.toLowerCase(), keys });
  } catch (_) {
    throw invalidKeyring();
  }

  return { activeKeyId: activeKeyId.toLowerCase(), keys };
};

const getKey = (keyId: string, keyring: MessagingKeyring): Buffer => {
  const encodedKey = keyring.keys[keyId];
  if (!encodedKey) {
    throw invalidSecret();
  }

  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) {
    throw invalidSecret();
  }
  return key;
};

export const encryptMessagingSecret = (secret: string, keyring: MessagingKeyring): string => {
  const keyId = keyring.activeKeyId;
  const key = getKey(keyId, keyring);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    keyId,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url")
  ].join(".");
};

export const decryptMessagingSecret = (encryptedSecret: string, keyring: MessagingKeyring): string => {
  try {
    const [keyId, encodedIv, encodedTag, encodedCiphertext, extra] = encryptedSecret.split(".");
    if (!keyId || !encodedIv || !encodedTag || !encodedCiphertext || extra) {
      throw invalidSecret();
    }

    const key = getKey(keyId, keyring);
    const iv = Buffer.from(encodedIv, "base64url");
    const tag = Buffer.from(encodedTag, "base64url");
    const ciphertext = Buffer.from(encodedCiphertext, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
      throw invalidSecret();
    }

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch (_) {
    throw invalidSecret();
  }
};
