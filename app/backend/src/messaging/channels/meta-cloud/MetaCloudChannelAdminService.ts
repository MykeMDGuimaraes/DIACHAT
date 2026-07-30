import AppError from "../../../errors/AppError";
import MetaGraphApiClient, {
  MetaConnectionInput,
  MetaConnectionValidation
} from "../../adapters/meta-cloud/MetaGraphApiClient";
import MetaCloudCredential from "../../persistence/models/MetaCloudCredential";
import {
  encryptMessagingSecret,
  loadMessagingKeyring,
  MessagingKeyring
} from "../../security/MessagingSecretCipher";

interface Dependencies {
  findCredential(companyId: number, whatsappId: number): Promise<any>;
  listCredentials(companyId: number): Promise<any[]>;
  validateConnection(input: MetaConnectionInput): Promise<MetaConnectionValidation>;
  encryptSecret(value: string, keyring: MessagingKeyring): string;
  keyring: MessagingKeyring;
}

const defaults = (): Dependencies => ({
  findCredential: (companyId, whatsappId) =>
    MetaCloudCredential.findOne({ where: { companyId, whatsappId } }),
  listCredentials: companyId =>
    MetaCloudCredential.findAll({
      where: { companyId },
      attributes: [
        "publicId",
        "whatsappId",
        "appId",
        "wabaId",
        "phoneNumberId",
        "graphVersion",
        "validationStatus",
        "webhookVerifiedAt",
        "lastValidatedAt",
        "lastError",
        "revokedAt"
      ]
    }),
  validateConnection: input => new MetaGraphApiClient().validateConnection(input),
  encryptSecret: encryptMessagingSecret,
  keyring: loadMessagingKeyring()
});

class MetaCloudChannelAdminService {
  constructor(private readonly dependencies: Dependencies = defaults()) {}

  list(companyId: number): Promise<any[]> {
    return this.dependencies.listCredentials(companyId);
  }

  private async get(companyId: number, whatsappId: number): Promise<any> {
    const credential = await this.dependencies.findCredential(companyId, whatsappId);
    if (!credential) throw new AppError("Canal Meta nao encontrado", 404);
    return credential;
  }

  async rotate(
    companyId: number,
    whatsappId: number,
    input: { appSecret: string; accessToken: string }
  ): Promise<Record<string, unknown>> {
    const credential = await this.get(companyId, whatsappId);
    if (!input.appSecret || !input.accessToken) {
      throw new AppError("Novos segredos Meta sao obrigatorios", 400);
    }
    await this.dependencies.validateConnection({
      appId: credential.appId,
      appSecret: input.appSecret,
      accessToken: input.accessToken,
      wabaId: credential.wabaId,
      phoneNumberId: credential.phoneNumberId,
      graphVersion: credential.graphVersion
    });
    await credential.update({
      appSecretCiphertext: this.dependencies.encryptSecret(
        input.appSecret,
        this.dependencies.keyring
      ),
      accessTokenCiphertext: this.dependencies.encryptSecret(
        input.accessToken,
        this.dependencies.keyring
      ),
      keyVersion: this.dependencies.keyring.activeKeyId,
      validationStatus: "VALID",
      lastValidatedAt: new Date(),
      lastError: null,
      revokedAt: null
    });
    return { whatsappId, validationStatus: "VALID" };
  }

  async revoke(companyId: number, whatsappId: number): Promise<void> {
    const credential = await this.get(companyId, whatsappId);
    await credential.update({
      validationStatus: "REVOKED",
      accessTokenCiphertext: "",
      appSecretCiphertext: "",
      revokedAt: new Date()
    });
  }
}

export default MetaCloudChannelAdminService;
