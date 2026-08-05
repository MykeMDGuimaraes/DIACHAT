import path from "path";
import { v4 as uuidv4 } from "uuid";
import Whatsapp from "../models/Whatsapp";
import {
  OutboundMessageService,
  stageMessagingMedia,
  messageKindForFile
} from "../messaging/public/outbound";

const outboundMessageService = new OutboundMessageService();

export type MessageData = {
  number: number | string;
  body: string;
  mediaPath?: string;
  fileName?: string;
};

export const SendMessage = async (
  whatsapp: Whatsapp,
  messageData: MessageData
): Promise<any> => {
  try {
    if (messageData.mediaPath) {
      const fileName =
        messageData.fileName || path.basename(messageData.mediaPath);
      const localPath = await stageMessagingMedia(
        messageData.mediaPath,
        fileName
      );

      return await outboundMessageService.create({
        companyId: whatsapp.companyId,
        whatsappId: whatsapp.id,
        recipient: String(messageData.number),
        idempotencyScope: "legacy-queue-send",
        idempotencyKey: uuidv4(),
        kind: messageKindForFile(fileName),
        payload: {
          localPath,
          fileName: messageData.fileName,
          caption: messageData.body
        },
        origin: "automation"
      });
    }

    return await outboundMessageService.create({
      companyId: whatsapp.companyId,
      whatsappId: whatsapp.id,
      recipient: String(messageData.number),
      idempotencyScope: "legacy-queue-send",
      idempotencyKey: uuidv4(),
      kind: "text",
      text: `\u200e ${messageData.body}`,
      origin: "automation"
    });
  } catch (err: any) {
    throw new Error(err);
  }
};
