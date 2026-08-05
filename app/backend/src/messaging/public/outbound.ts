/**
 * Fachada publica de aceitacao de envios (Task 4). O core cria comandos
 * de saida e estagia midia SOMENTE por aqui — nunca pelos internals de
 * application/api. Fronteira verificada por check:messaging-architecture.
 */
export { default as OutboundMessageService } from "../application/OutboundMessageService";
export type {
  CreateOutboundMessageInput,
  OutboundMessageKind
} from "../application/OutboundMessageService";
export {
  persistMessagingUpload,
  stageMessagingMedia,
  messageKindForMime,
  messageKindForFile
} from "../application/persistMessagingUpload";
export {
  privateMediaDirectory,
  privateMediaRelativePath,
  publicMediaUpload
} from "../api/PublicMediaUpload";
