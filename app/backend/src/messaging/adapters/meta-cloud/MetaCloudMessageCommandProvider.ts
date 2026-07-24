import AppError from "../../../errors/AppError";
import { DispatchableMessageCommand, MessagingProvider } from "../../contracts/MessagingProvider";
import MetaCloudCredential from "../../persistence/models/MetaCloudCredential";
import {
  decryptMessagingSecret,
  loadMessagingKeyring,
  MessagingKeyring
} from "../../security/MessagingSecretCipher";
import MetaGraphApiClient, { MetaTextMessageInput } from "./MetaGraphApiClient";

interface MetaCloudMessageCommandProviderDependencies {
  findCredential(companyId: number, whatsappId: number): Promise<any>;
  decryptSecret(encryptedSecret: string, keyring: MessagingKeyring): string;
  getKeyring(): MessagingKeyring;
  sendText(input: MetaTextMessageInput): Promise<{ providerMessageId?: string }>;
}

const defaultDependencies = (): MetaCloudMessageCommandProviderDependencies => {
  return {
    findCredential: (companyId, whatsappId) =>
      MetaCloudCredential.findOne({ where: { companyId, whatsappId } }),
    decryptSecret: decryptMessagingSecret,
    getKeyring: loadMessagingKeyring,
    sendText: input => new MetaGraphApiClient().sendText(input)
  };
};

class MetaCloudMessageCommandProvider implements MessagingProvider {
  readonly provider = "meta_cloud";

  private readonly dependencies: MetaCloudMessageCommandProviderDependencies;

  constructor(dependencies?: MetaCloudMessageCommandProviderDependencies) {
    this.dependencies = dependencies || defaultDependencies();
  }

  async send(command: DispatchableMessageCommand): Promise<{ providerMessageId?: string }> {
    const text = command.requestPayload.text;
    if (command.messageKind !== "text" || typeof text !== "string" || !text.trim()) {
      throw new AppError("Payload de texto invÃ¡lido", 400);
    }

    const credential = await this.dependencies.findCredential(command.companyId, command.whatsappId);
    if (!credential) {
      throw new AppError("Credenciais Meta do canal nÃ£o encontradas", 404);
    }
    const accessToken = this.dependencies.decryptSecret(
      credential.accessTokenCiphertext,
      this.dependencies.getKeyring()
    );

    return this.dependencies.sendText({
      phoneNumberId: credential.phoneNumberId,
      accessToken,
      recipient: command.recipient,
      text
    });
  }
}

export default MetaCloudMessageCommandProvider;
