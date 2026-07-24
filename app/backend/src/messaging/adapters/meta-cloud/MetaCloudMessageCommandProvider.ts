import AppError from "../../../errors/AppError";
import { DispatchableMessageCommand, MessagingProvider } from "../../contracts/MessagingProvider";
import MetaCloudCredential from "../../persistence/models/MetaCloudCredential";
import {
  decryptMessagingSecret,
  loadMessagingKeyring,
  MessagingKeyring
} from "../../security/MessagingSecretCipher";
import MetaGraphApiClient, { MetaMessageInput, MetaTextMessageInput } from "./MetaGraphApiClient";

interface MetaCloudMessageCommandProviderDependencies {
  findCredential(companyId: number, whatsappId: number): Promise<any>;
  decryptSecret(encryptedSecret: string, keyring: MessagingKeyring): string;
  getKeyring(): MessagingKeyring;
  sendText(input: MetaTextMessageInput): Promise<{ providerMessageId?: string }>;
  sendMessage?(input: MetaMessageInput): Promise<{ providerMessageId?: string }>;
}

const defaultDependencies = (): MetaCloudMessageCommandProviderDependencies => ({
  findCredential: (companyId, whatsappId) =>
    MetaCloudCredential.findOne({ where: { companyId, whatsappId } }),
  decryptSecret: decryptMessagingSecret,
  getKeyring: loadMessagingKeyring,
  sendText: input => new MetaGraphApiClient().sendText(input),
  sendMessage: input => new MetaGraphApiClient().sendMessage(input)
});

class MetaCloudMessageCommandProvider implements MessagingProvider {
  readonly provider = "meta_cloud";

  private readonly dependencies: MetaCloudMessageCommandProviderDependencies;

  constructor(dependencies?: MetaCloudMessageCommandProviderDependencies) {
    this.dependencies = dependencies || defaultDependencies();
  }

  async send(command: DispatchableMessageCommand): Promise<{ providerMessageId?: string }> {
    const supported = ["text", "image", "audio", "video", "document", "template"];
    if (!supported.includes(command.messageKind)) {
      throw new AppError("Tipo de mensagem Meta nao suportado", 400);
    }

    const credential = await this.dependencies.findCredential(command.companyId, command.whatsappId);
    if (!credential) {
      throw new AppError("Credenciais Meta do canal nao encontradas", 404);
    }
    if (
      credential.validationStatus === "REVOKED" ||
      credential.revokedAt
    ) {
      throw new AppError("Credenciais Meta do canal foram revogadas", 409);
    }
    const accessToken = this.dependencies.decryptSecret(
      credential.accessTokenCiphertext,
      this.dependencies.getKeyring()
    );

    if (command.messageKind === "text") {
      const text = command.requestPayload.text;
      if (typeof text !== "string" || !text.trim()) {
        throw new AppError("Payload de texto invalido", 400);
      }
      return this.dependencies.sendText({
        phoneNumberId: credential.phoneNumberId,
        accessToken,
        recipient: command.recipient,
        text,
        ...(credential.graphVersion ? { graphVersion: credential.graphVersion } : {})
      });
    }

    if (!this.dependencies.sendMessage) {
      throw new AppError("Envio Meta indisponivel", 500);
    }
    return this.dependencies.sendMessage({
      phoneNumberId: credential.phoneNumberId,
      accessToken,
      recipient: command.recipient,
      kind: command.messageKind as MetaMessageInput["kind"],
      payload: command.requestPayload,
      ...(credential.graphVersion ? { graphVersion: credential.graphVersion } : {})
    });
  }
}

export default MetaCloudMessageCommandProvider;
