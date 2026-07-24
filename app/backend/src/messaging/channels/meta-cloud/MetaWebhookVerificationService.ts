import { timingSafeEqual } from "crypto";

import AppError from "../../../errors/AppError";
import MetaCloudCredential from "../../persistence/models/MetaCloudCredential";
import { hashMetaWebhookVerifyToken } from "./CreateMetaCloudChannelService";

export interface MetaWebhookChallengeInput {
  credentialPublicId: string;
  mode: string | undefined;
  verifyToken: string | undefined;
  challenge: string | undefined;
}

interface MetaWebhookVerificationDependencies {
  findCredential(publicId: string): Promise<any>;
  hashVerifyToken(token: string): string;
}

const defaultDependencies: MetaWebhookVerificationDependencies = {
  findCredential: publicId => MetaCloudCredential.findOne({ where: { publicId } }),
  hashVerifyToken: hashMetaWebhookVerifyToken
};

const matchesHash = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

export const verifyMetaWebhookChallenge = async (
  input: MetaWebhookChallengeInput,
  dependencies: MetaWebhookVerificationDependencies = defaultDependencies
): Promise<string> => {
  if (input.mode !== "subscribe" || !input.verifyToken || !input.challenge) {
    throw new AppError("Desafio Meta invÃ¡lido", 403);
  }

  const credential = await dependencies.findCredential(input.credentialPublicId);
  if (!credential) {
    throw new AppError("Canal Meta nÃ£o encontrado", 404);
  }

  if (!matchesHash(dependencies.hashVerifyToken(input.verifyToken), credential.verifyTokenHash)) {
    throw new AppError("Verify token Meta invÃ¡lido", 403);
  }

  await credential.update({
    validationStatus: "WEBHOOK_VERIFIED",
    webhookVerifiedAt: new Date(),
    lastError: null
  });
  return input.challenge;
};
