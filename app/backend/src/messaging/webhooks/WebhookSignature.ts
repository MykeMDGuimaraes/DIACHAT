import { createHmac, timingSafeEqual } from "crypto";

const createSignature = (
  secret: string,
  timestamp: string,
  rawBody: string
): string =>
  `sha256=${createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex")}`;

export const signWebhookPayload = (
  secret: string,
  timestamp: string,
  rawBody: string
): string => createSignature(secret, timestamp, rawBody);

export const verifyWebhookSignature = (
  secret: string,
  timestamp: string,
  rawBody: string,
  receivedSignature: string
): boolean => {
  const expected = Buffer.from(createSignature(secret, timestamp, rawBody));
  const received = Buffer.from(receivedSignature);

  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
};
