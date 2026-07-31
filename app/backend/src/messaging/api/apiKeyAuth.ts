import { NextFunction, Request, Response } from "express";
import AppError from "../../errors/AppError";
import { parsePublicApiKey, verifyApiKeySecret } from "../domain/PublicApiKey";
import ApiCredential from "../persistence/models/ApiCredential";

const apiKeyAuth = async (
  req: Request,
  _: Response,
  next: NextFunction
): Promise<void> => {
  const authorization = req.headers.authorization;
  const pepper = process.env.API_KEY_PEPPER;

  if (!authorization?.startsWith("Bearer ") || !pepper) {
    throw new AppError("Credencial de API inválida", 401);
  }

  let parsed;
  try {
    parsed = parsePublicApiKey(authorization.slice("Bearer ".length));
  } catch {
    throw new AppError("Credencial de API inválida", 401);
  }

  const credential = await ApiCredential.findOne({
    where: { tokenId: parsed.tokenId, revokedAt: null }
  });

  if (
    !credential ||
    !verifyApiKeySecret(parsed.secret, pepper, credential.secretHash)
  ) {
    throw new AppError("Credencial de API inválida", 401);
  }

  req.apiCredential = {
    id: credential.id,
    companyId: credential.companyId,
    scopes: credential.scopes,
    connectionIds: credential.connectionIds
  };

  await credential.update({ lastUsedAt: new Date() });
  next();
};

export default apiKeyAuth;
