import { createHmac, randomBytes } from "crypto";

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
import CreateWhatsAppService from "../../../services/WhatsappService/CreateWhatsAppService";

export interface CreateMetaCloudChannelInput extends MetaConnectionInput {
  companyId: number;
  name: string;
  graphVersion: string;
}

interface CreatedWhatsapp {
  whatsapp: { id: number };
}

interface CreatedCredential {
  publicId: string;
}

export interface CreateMetaCloudChannelDependencies {
  validateConnection(input: MetaConnectionInput): Promise<MetaConnectionValidation>;
  createWhatsapp(input: Record<string, unknown>): Promise<CreatedWhatsapp>;
  createCredential(input: Record<string, unknown>): Promise<CreatedCredential>;
  encryptSecret(secret: string, keyring: MessagingKeyring): string;
  keyring: MessagingKeyring;
  generateVerifyToken(): string;
  hashVerifyToken(token: string): string;
}

export interface CreatedMetaCloudChannel {
  whatsappId: number;
  credentialPublicId: string;
  verifyToken: string;
  displayPhoneNumber?: string;
}

const loadVerifyTokenPepper = (): string => {
  const pepper = process.env.MESSAGING_WEBHOOK_VERIFY_TOKEN_PEPPER;
  if (!pepper) {
    throw new Error("MESSAGING_WEBHOOK_VERIFY_TOKEN_PEPPER nÃ£o configurado");
  }
  return pepper;
};

export const hashMetaWebhookVerifyToken = (token: string): string =>
  createHmac("sha256", loadVerifyTokenPepper()).update(token).digest("hex");

const defaultDependencies = (): CreateMetaCloudChannelDependencies => {
  const client = new MetaGraphApiClient();
  return {
    validateConnection: input => client.validateConnection(input),
    createWhatsapp: input => CreateWhatsAppService(input as any),
    createCredential: input => MetaCloudCredential.create(input as any) as any,
    encryptSecret: encryptMessagingSecret,
    keyring: loadMessagingKeyring(),
    generateVerifyToken: () => randomBytes(32).toString("base64url"),
    hashVerifyToken: hashMetaWebhookVerifyToken
  };
};

export const createMetaCloudChannel = async (
  input: CreateMetaCloudChannelInput,
  dependencies: CreateMetaCloudChannelDependencies = defaultDependencies()
): Promise<CreatedMetaCloudChannel> => {
  if (!/^v\d+\.\d+$/.test(input.graphVersion)) {
    throw new Error("graphVersion invalida");
  }
  const validation = await dependencies.validateConnection(input);
  const { whatsapp } = await dependencies.createWhatsapp({
    companyId: input.companyId,
    name: input.name,
    status: "OPEN",
    isDefault: false,
    queueIds: [],
    token: "",
    channelType: "meta_cloud"
  });

  const verifyToken = dependencies.generateVerifyToken();
  const credential = await dependencies.createCredential({
    companyId: input.companyId,
    whatsappId: whatsapp.id,
    appId: input.appId,
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
    graphVersion: input.graphVersion,
    accessTokenCiphertext: dependencies.encryptSecret(input.accessToken, dependencies.keyring),
    appSecretCiphertext: dependencies.encryptSecret(input.appSecret, dependencies.keyring),
    verifyTokenHash: dependencies.hashVerifyToken(verifyToken),
    keyVersion: dependencies.keyring.activeKeyId,
    validationStatus: "PENDING_WEBHOOK",
    lastValidatedAt: new Date()
  });

  return {
    whatsappId: whatsapp.id,
    credentialPublicId: credential.publicId,
    verifyToken,
    displayPhoneNumber: validation.displayPhoneNumber
  };
};
