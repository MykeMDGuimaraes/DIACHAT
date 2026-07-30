import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual
} from "crypto";

import { MessagingKeyring } from "../security/MessagingSecretCipher";

export interface WebhookBodyBinding {
  companyId: number;
  subscriptionId: string;
  deliveryId: string;
  eventId: string;
}

export interface EncryptedWebhookBody {
  bodyCiphertext: string;
  bodyKeyVersion: string;
  bodySha256: string;
}

const invalidBody = (): Error => new Error("Corpo de webhook inválido");

const keyFor = (keyVersion: string, keyring: MessagingKeyring): Buffer => {
  const encoded = keyring.keys[keyVersion];
  if (!encoded) throw invalidBody();
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw invalidBody();
  return key;
};

const aadFor = (binding: WebhookBodyBinding): Buffer =>
  Buffer.from(
    JSON.stringify([
      "diachat-webhook-body/v1",
      binding.companyId,
      binding.subscriptionId,
      binding.deliveryId,
      binding.eventId
    ]),
    "utf8"
  );

const digest = (body: Buffer): string =>
  createHash("sha256").update(body).digest("hex");

export const encryptWebhookBody = (
  rawBody: Buffer,
  binding: WebhookBodyBinding,
  keyring: MessagingKeyring
): EncryptedWebhookBody => {
  const bodyKeyVersion = keyring.activeKeyId;
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    keyFor(bodyKeyVersion, keyring),
    iv
  );
  cipher.setAAD(aadFor(binding));
  const ciphertext = Buffer.concat([cipher.update(rawBody), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    bodyCiphertext: [
      iv.toString("base64url"),
      tag.toString("base64url"),
      ciphertext.toString("base64url")
    ].join("."),
    bodyKeyVersion,
    bodySha256: digest(rawBody)
  };
};

export const decryptWebhookBody = (
  encrypted: EncryptedWebhookBody,
  binding: WebhookBodyBinding,
  keyring: MessagingKeyring
): Buffer => {
  try {
    const [encodedIv, encodedTag, encodedCiphertext, extra] =
      encrypted.bodyCiphertext.split(".");
    if (!encodedIv || !encodedTag || !encodedCiphertext || extra) {
      throw invalidBody();
    }
    const iv = Buffer.from(encodedIv, "base64url");
    const tag = Buffer.from(encodedTag, "base64url");
    const ciphertext = Buffer.from(encodedCiphertext, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
      throw invalidBody();
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      keyFor(encrypted.bodyKeyVersion, keyring),
      iv
    );
    decipher.setAAD(aadFor(binding));
    decipher.setAuthTag(tag);
    const rawBody = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);
    const expected = Buffer.from(encrypted.bodySha256, "hex");
    const actual = Buffer.from(digest(rawBody), "hex");
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      throw invalidBody();
    }
    return rawBody;
  } catch (_) {
    throw invalidBody();
  }
};
