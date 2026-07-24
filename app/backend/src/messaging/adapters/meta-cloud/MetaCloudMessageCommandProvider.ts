import AppError from "../../../errors/AppError";
import {
  DispatchableMessageCommand,
  MessagingProvider
} from "../../contracts/MessagingProvider";
import {
  parseRetryAfterMs,
  PermanentSendError,
  ProviderSendError,
  RetryableSendError,
  UnknownSendError
} from "../../contracts/ProviderSendError";
import { MetaGraphTransportError } from "./MetaGraphApiClient";
import MetaCloudCredential from "../../persistence/models/MetaCloudCredential";
import {
  decryptMessagingSecret,
  loadMessagingKeyring,
  MessagingKeyring
} from "../../security/MessagingSecretCipher";
import MetaGraphApiClient, {
  MetaMessageInput,
  MetaTextMessageInput
} from "./MetaGraphApiClient";

interface MetaCloudMessageCommandProviderDependencies {
  findCredential(companyId: number, whatsappId: number): Promise<any>;
  decryptSecret(encryptedSecret: string, keyring: MessagingKeyring): string;
  getKeyring(): MessagingKeyring;
  sendText(
    input: MetaTextMessageInput
  ): Promise<{ providerMessageId?: string }>;
  sendMessage?(
    input: MetaMessageInput
  ): Promise<{ providerMessageId?: string }>;
}

const defaultDependencies =
  (): MetaCloudMessageCommandProviderDependencies => ({
    findCredential: (companyId, whatsappId) =>
      MetaCloudCredential.findOne({ where: { companyId, whatsappId } }),
    decryptSecret: decryptMessagingSecret,
    getKeyring: loadMessagingKeyring,
    sendText: input => new MetaGraphApiClient().sendText(input),
    sendMessage: input => new MetaGraphApiClient().sendMessage(input)
  });

export const classifyMetaSendError = (error: unknown): ProviderSendError => {
  if (error instanceof ProviderSendError) {
    return error;
  }

  if (error instanceof MetaGraphTransportError) {
    if (error.phase === "before_transmission") {
      return new RetryableSendError({
        code: "META_NETWORK_BEFORE_TRANSMISSION",
        message: error.message,
        details: { cause: error.cause || null }
      });
    }

    if (error.phase === "response" && typeof error.statusCode === "number") {
      const status = error.statusCode;
      const graphError = (error.errorBody as any)?.error;
      const isTransient = graphError?.is_transient === true;
      const graphCode = graphError?.code;
      // 4 = rate limit da app, 80007 = rate limit da WABA
      const isRateLimit =
        status === 429 || graphCode === 4 || graphCode === 80007;

      if (status >= 500 || isTransient || isRateLimit) {
        return new RetryableSendError({
          code: isRateLimit ? "META_RATE_LIMITED" : "META_SERVER_ERROR",
          message: error.message,
          providerStatus: status,
          retryAfterMs: parseRetryAfterMs(error.retryAfterHeader),
          details: {
            graphCode: graphCode ?? null,
            graphMessage:
              typeof graphError?.message === "string"
                ? graphError.message
                : null
          }
        });
      }

      return new PermanentSendError({
        code: "META_REQUEST_REJECTED",
        message: error.message,
        providerStatus: status,
        details: {
          graphCode: graphCode ?? null,
          graphMessage:
            typeof graphError?.message === "string" ? graphError.message : null
        }
      });
    }

    // after_transmission: timeout/reset apos o request partir, ou 2xx ilegivel
    return new UnknownSendError({
      code: "META_OUTCOME_AMBIGUOUS",
      message: error.message,
      providerStatus: error.statusCode,
      details: { cause: error.cause || null }
    });
  }

  if (error instanceof AppError) {
    // Validacoes locais (payload, credencial, tipo) sao deterministicas
    return new PermanentSendError({
      code: "META_VALIDATION_FAILED",
      message: error.message,
      providerStatus: error.statusCode
    });
  }

  return new UnknownSendError({
    code: "META_UNEXPECTED_ERROR",
    message: error instanceof Error ? error.message : "erro inesperado"
  });
};

class MetaCloudMessageCommandProvider implements MessagingProvider {
  readonly provider = "meta_cloud";

  private readonly dependencies: MetaCloudMessageCommandProviderDependencies;

  constructor(dependencies?: MetaCloudMessageCommandProviderDependencies) {
    this.dependencies = dependencies || defaultDependencies();
  }

  async send(
    command: DispatchableMessageCommand
  ): Promise<{ providerMessageId?: string }> {
    try {
      const result = await this.doSend(command);
      if (!result.providerMessageId) {
        throw new UnknownSendError({
          code: "META_MISSING_MESSAGE_ID",
          message: "Resposta 2xx da Meta sem messages[0].id"
        });
      }
      return result;
    } catch (error) {
      throw classifyMetaSendError(error);
    }
  }

  private async doSend(
    command: DispatchableMessageCommand
  ): Promise<{ providerMessageId?: string }> {
    const supported = [
      "text",
      "image",
      "audio",
      "video",
      "document",
      "template"
    ];
    if (!supported.includes(command.messageKind)) {
      throw new AppError("Tipo de mensagem Meta nao suportado", 400);
    }

    const credential = await this.dependencies.findCredential(
      command.companyId,
      command.whatsappId
    );
    if (!credential) {
      throw new AppError("Credenciais Meta do canal nao encontradas", 404);
    }
    if (credential.validationStatus === "REVOKED" || credential.revokedAt) {
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
        ...(credential.graphVersion
          ? { graphVersion: credential.graphVersion }
          : {})
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
      ...(credential.graphVersion
        ? { graphVersion: credential.graphVersion }
        : {})
    });
  }
}

export default MetaCloudMessageCommandProvider;
