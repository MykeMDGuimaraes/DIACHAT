import { createHmac, timingSafeEqual } from "crypto";
import AppError from "../../errors/AppError";

const secret = (): string => {
  const value = process.env.SESSION_SECRET || process.env.JWT_SECRET;
  if (!value) throw new AppError("Segredo de anexos não configurado", 503);
  return value;
};

const digest = (
  messageId: string,
  companyId: number,
  expires: number
): string =>
  createHmac("sha256", secret())
    .update(`${messageId}.${companyId}.${expires}`)
    .digest("hex");

export const signTranscriptAttachment = (
  messageId: string,
  companyId: number,
  now = new Date()
): string => {
  const expires = Math.floor(now.getTime() / 1000) + 300;
  const signature = digest(messageId, companyId, expires);
  return `/api/v1/transcript/media/${encodeURIComponent(
    messageId
  )}?companyId=${companyId}&expires=${expires}&signature=${signature}`;
};

export const verifyTranscriptAttachment = (input: {
  messageId: string;
  companyId: number;
  expires: number;
  signature: string;
  now?: Date;
}): boolean => {
  const nowSeconds = Math.floor((input.now || new Date()).getTime() / 1000);
  if (
    !Number.isInteger(input.companyId) ||
    !Number.isInteger(input.expires) ||
    input.expires < nowSeconds ||
    input.expires > nowSeconds + 300 ||
    !/^[a-f0-9]{64}$/i.test(input.signature)
  ) {
    return false;
  }
  const expected = Buffer.from(
    digest(input.messageId, input.companyId, input.expires),
    "hex"
  );
  const received = Buffer.from(input.signature, "hex");
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
};
