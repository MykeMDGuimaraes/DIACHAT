export type MessagingCapability =
  | "text"
  | "media"
  | "presence"
  | "buttons"
  | "reactions"
  | "messageEdit"
  | "messageDelete"
  | "internalTemplate"
  | "officialTemplate";

export type MessagingProviderName = "baileys" | "meta_cloud";

export type ProviderCapabilities = Record<MessagingCapability, boolean>;

const matrix: Record<MessagingProviderName, ProviderCapabilities> = {
  baileys: {
    text: true, media: true, presence: true, buttons: true, reactions: true,
    messageEdit: true, messageDelete: true, internalTemplate: true, officialTemplate: false
  },
  meta_cloud: {
    text: true, media: true, presence: false, buttons: false, reactions: false,
    messageEdit: false, messageDelete: false, internalTemplate: true, officialTemplate: true
  }
};

export const capabilitiesFor = (provider: string): ProviderCapabilities =>
  matrix[provider === "meta_cloud" ? "meta_cloud" : "baileys"];

export const providerForChannel = (channelType?: string | null): MessagingProviderName =>
  channelType === "meta_cloud" ? "meta_cloud" : "baileys";
