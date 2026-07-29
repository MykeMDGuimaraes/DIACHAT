import {
  generateWAMessageFromContent,
  proto,
  type WAMessage,
  type WASocket
} from "baileys";

export interface NativeQuickReply {
  id: string;
  title: string;
}

export const buildNativeButtonsMessageContent = (
  text: string,
  buttons: NativeQuickReply[]
): proto.IMessage =>
  proto.Message.fromObject({
    viewOnceMessage: {
      message: {
        interactiveMessage: {
          body: { text },
          nativeFlowMessage: {
            buttons: buttons.map(button => ({
              name: "quick_reply",
              buttonParamsJson: JSON.stringify({
                display_text: button.title,
                id: button.id
              })
            }))
          }
        }
      }
    }
  });

export const relayNativeButtons = async (
  socket: Pick<WASocket, "relayMessage" | "user">,
  jid: string,
  text: string,
  buttons: NativeQuickReply[],
  messageId: string,
  quoted?: WAMessage
): Promise<WAMessage> => {
  if (!socket.user?.id) throw new Error("BAILEYS_SOCKET_USER_UNAVAILABLE");
  const message = generateWAMessageFromContent(
    jid,
    buildNativeButtonsMessageContent(text, buttons),
    {
      userJid: socket.user.id,
      messageId,
      ...(quoted ? { quoted } : {})
    }
  );
  await socket.relayMessage(jid, message.message!, {
    messageId
  });
  return message;
};
