import { createHmac, timingSafeEqual } from "crypto";

export const verifyMetaWebhookSignature = (
  appSecret: string,
  rawBody: string,
  receivedSignature: string | undefined
): boolean => {
  if (!receivedSignature) {
    return false;
  }

  const expected = Buffer.from(
    `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`,
    "utf8"
  );
  const received = Buffer.from(receivedSignature, "utf8");

  return expected.length === received.length && timingSafeEqual(expected, received);
};
