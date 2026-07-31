import Whatsapp from "../models/Whatsapp";

export type MessageData = {
  number: number | string;
  body: string;
  mediaPath?: string;
};

export const SendMessageFlow = async (
  whatsapp: Whatsapp,
  messageData: MessageData,
  _isFlow: boolean = false,
  _isRecord: boolean = false
): Promise<any> => {
  try {
    let message;

    message = ""; // TODO: reimplementar template buttons pela porta de mensageria.

    return message;
  } catch (err: any) {
    throw new Error(err);
  }
};
