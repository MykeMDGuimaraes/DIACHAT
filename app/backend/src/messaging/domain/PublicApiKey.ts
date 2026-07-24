import { createHmac, timingSafeEqual } from "crypto";

const API_KEY_PATTERN = /^dch_live_([A-Za-z0-9_-]{8,64})\.([A-Za-z0-9_-]{16,256})$/;

export interface ParsedPublicApiKey {
  tokenId: string;
  secret: string;
}

export const parsePublicApiKey = (value: string): ParsedPublicApiKey => {
  const match = API_KEY_PATTERN.exec(value.trim());

  if (!match) {
    throw new Error("Credencial de API inválida");
  }

  return { tokenId: match[1], secret: match[2] };
};

export const hashApiKeySecret = (secret: string, pepper: string): string =>
  createHmac("sha256", pepper).update(secret).digest("hex");

export const verifyApiKeySecret = (
  secret: string,
  pepper: string,
  expectedHash: string
): boolean => {
  const expected = Buffer.from(expectedHash, "hex");
  const received = Buffer.from(hashApiKeySecret(secret, pepper), "hex");

  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
};
