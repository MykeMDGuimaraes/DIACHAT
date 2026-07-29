import { createHmac, timingSafeEqual } from "crypto";

import {
  loadMessagingKeyring,
  MessagingKeyring
} from "../security/MessagingSecretCipher";

export const WEBHOOK_MEDIA_TTL_SECONDS = 7 * 24 * 60 * 60;

const signingKey = (
  keyVersion: string,
  keyring: MessagingKeyring
): Buffer | null => {
  const encoded = keyring.keys[keyVersion.toLowerCase()];
  if (!encoded) return null;
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) return null;
  return createHmac("sha256", key)
    .update("dia-chat:webhook-media:v1", "utf8")
    .digest();
};

const digest = (
  messageId: string,
  companyId: number,
  expires: number,
  keyVersion: string,
  keyring: MessagingKeyring
): string | null => {
  const key = signingKey(keyVersion, keyring);
  if (!key) return null;
  return createHmac("sha256", key)
    .update(
      JSON.stringify([
        "webhook-media/1",
        keyVersion.toLowerCase(),
        companyId,
        messageId,
        expires
      ]),
      "utf8"
    )
    .digest("hex");
};

export const signWebhookMediaUrl = (
  messageId: string,
  companyId: number,
  now = new Date(),
  keyring = loadMessagingKeyring()
): string => {
  const keyVersion = keyring.activeKeyId.toLowerCase();
  const expires =
    Math.floor(now.getTime() / 1000) + WEBHOOK_MEDIA_TTL_SECONDS;
  const token = digest(messageId, companyId, expires, keyVersion, keyring);
  if (!token) throw new Error("Keyring de mídia de webhook inválido");
  return `/api/v1/webhook-media/${encodeURIComponent(
    messageId
  )}?companyId=${companyId}&expires=${expires}&keyVersion=${encodeURIComponent(
    keyVersion
  )}&token=${token}`;
};

export const verifyWebhookMediaToken = (input: {
  messageId: string;
  companyId: number;
  expires: number;
  keyVersion: string;
  token: string;
  now?: Date;
  keyring?: MessagingKeyring;
}): boolean => {
  const nowSeconds = Math.floor((input.now || new Date()).getTime() / 1000);
  if (
    !input.messageId ||
    !Number.isInteger(input.companyId) ||
    input.companyId <= 0 ||
    !Number.isInteger(input.expires) ||
    input.expires < nowSeconds ||
    input.expires > nowSeconds + WEBHOOK_MEDIA_TTL_SECONDS ||
    !/^[a-z0-9_-]{1,64}$/i.test(input.keyVersion) ||
    !/^[a-f0-9]{64}$/i.test(input.token)
  ) {
    return false;
  }
  const expected = digest(
    input.messageId,
    input.companyId,
    input.expires,
    input.keyVersion,
    input.keyring || loadMessagingKeyring()
  );
  if (!expected) return false;
  const receivedBytes = Buffer.from(input.token, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return (
    receivedBytes.length === expectedBytes.length &&
    timingSafeEqual(receivedBytes, expectedBytes)
  );
};
