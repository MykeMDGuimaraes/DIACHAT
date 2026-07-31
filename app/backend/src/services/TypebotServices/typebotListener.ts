import { sendBaileysSocketMessage } from "../../messaging/public/baileys";
import axios, { AxiosRequestConfig } from "axios";
import Ticket from "../../models/Ticket";
import QueueIntegrations from "../../models/QueueIntegrations";
import { WASocket, delay, proto } from "../../messaging/public/baileys";
import { getBodyMessage } from "../WbotServices/wbotMessageListener";
import { logger } from "../../utils/logger";
import { isNil } from "lodash";
import UpdateTicketService from "../TicketServices/UpdateTicketService";

type Session = WASocket & {
  id?: number;
};

interface Request {
  wbot: Session;
  msg: proto.IWebMessageInfo;
  ticket: Ticket;
  typebot: QueueIntegrations;
}

const typebotListener = async ({
  wbot,
  msg,
  ticket,
  typebot
}: Request): Promise<void> => {
  if (msg.key.remoteJid === "status@broadcast") return;

  const {
    urlN8N: url,
    typebotExpires,
    typebotKeywordFinish,
    typebotKeywordRestart,
    typebotUnknownMessage,
    typebotSlug,
    typebotDelayMessage,
    typebotRestartMessage
  } = typebot;

  const number = msg.key.remoteJid.replace(/\D/g, "");

  let body = getBodyMessage(msg);

  async function createSession(sessionMsg, _typebot, sessionNumber) {
    try {
      const reqData = JSON.stringify({
        isStreamEnabled: true,
        message: "string",
        resultId: "string",
        isOnlyRegistering: false,
        prefilledVariables: {
          number: sessionNumber,
          pushName: sessionMsg.pushName || ""
        }
      });

      const config: AxiosRequestConfig = {
        method: "post",
        maxBodyLength: Infinity,
        url: `${url}/api/v1/typebots/${typebotSlug}/startChat`,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        data: reqData
      };

      const request = await axios.request(config);

      return request.data;
    } catch (err) {
      logger.info("Erro ao criar sessão do typebot: ", err);
      throw err;
    }
  }

  let sessionId;
  let dataStart;
  let status = false;
  try {
    const dataLimite = new Date();
    dataLimite.setMinutes(dataLimite.getMinutes() - Number(typebotExpires));

    if (typebotExpires > 0 && ticket.updatedAt < dataLimite) {
      await ticket.update({
        typebotSessionId: null,
        isBot: true
      } as any);

      await ticket.reload();
    }

    if (isNil(ticket.typebotSessionId)) {
      dataStart = await createSession(msg, typebot, number);
      sessionId = dataStart.sessionId;
      status = true;
      await ticket.update({
        typebotSessionId: sessionId,
        typebotStatus: true,
        useIntegration: true,
        integrationId: typebot.id
      });
    } else {
      sessionId = ticket.typebotSessionId;
      status = ticket.typebotStatus;
    }

    if (!status) return;

    //let body = getConversationMessage(msg);

    if (body !== typebotKeywordFinish && body !== typebotKeywordRestart) {
      let requestContinue;
      let messages;
      let input;
      if (dataStart?.messages.length === 0 || dataStart === undefined) {
        const reqData = JSON.stringify({
          message: body
        });

        let config: AxiosRequestConfig = {
          method: "post",
          maxBodyLength: Infinity,
          url: `${url}/api/v1/sessions/${sessionId}/continueChat`,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          data: reqData
        };
        requestContinue = await axios.request(config);
        messages = requestContinue.data?.messages;
        input = requestContinue.data?.input;
      } else {
        messages = dataStart?.messages;
        input = dataStart?.input;
      }

      if (messages?.length === 0) {
        await sendBaileysSocketMessage(wbot, `${number}@c.us`, {
          text: typebotUnknownMessage
        });
      } else {
        for (const message of messages) {
          if (message.type === "text") {
            let formattedText = "";
            for (const richText of message.content.richText) {
              for (const element of richText.children) {
                let elementText = "";

                if (element.text) {
                  elementText = element.text;
                }
                if (element.type && element.children) {
                  for (const subelement of element.children) {
                    let subelementText = "";

                    if (subelement.text) {
                      subelementText = subelement.text;
                    }

                    if (subelement.type && subelement.children) {
                      for (const subelement2 of subelement.children) {
                        let subelement2Text = "";

                        if (subelement2.text) {
                          subelement2Text = subelement2.text;
                        }

                        if (subelement2.bold) {
                          subelement2Text = `*${subelement2Text}*`;
                        }
                        if (subelement2.italic) {
                          subelement2Text = `_${subelement2Text}_`;
                        }
                        if (subelement2.underline) {
                          subelement2Text = `~${subelement2Text}~`;
                        }
                        if (subelement2.url) {
                          const linkText = subelement2.children[0].text;
                          subelement2Text = `[${linkText}](${subelement2.url})`;
                        }
                        formattedText += subelement2Text;
                      }
                    }
                    if (subelement.bold) {
                      subelementText = `*${subelementText}*`;
                    }
                    if (subelement.italic) {
                      subelementText = `_${subelementText}_`;
                    }
                    if (subelement.underline) {
                      subelementText = `~${subelementText}~`;
                    }
                    if (subelement.url) {
                      const linkText = subelement.children[0].text;
                      subelementText = `[${linkText}](${subelement.url})`;
                    }
                    formattedText += subelementText;
                  }
                }

                if (element.bold) {
                  elementText = `*${elementText}*`;
                }
                if (element.italic) {
                  elementText = `_${elementText}_`;
                }
                if (element.underline) {
                  elementText = `~${elementText}~`;
                }

                if (element.url) {
                  const linkText = element.children[0].text;
                  elementText = `[${linkText}](${element.url})`;
                }

                formattedText += elementText;
              }
              formattedText += "\n";
            }
            formattedText = formattedText.replace("**", "").replace(/\n$/, "");

            if (formattedText === "Invalid message. Please, try again.") {
              formattedText = typebotUnknownMessage;
            }

            if (formattedText.startsWith("#")) {
              let gatilho = formattedText.replace("#", "");

              try {
                let jsonGatilho = JSON.parse(gatilho);

                if (
                  jsonGatilho.stopBot &&
                  isNil(jsonGatilho.userId) &&
                  isNil(jsonGatilho.queueId)
                ) {
                  await ticket.update({
                    useIntegration: false,
                    isBot: false
                  } as any);

                  return;
                }
                if (
                  !isNil(jsonGatilho.queueId) &&
                  jsonGatilho.queueId > 0 &&
                  isNil(jsonGatilho.userId)
                ) {
                  await UpdateTicketService({
                    ticketData: {
                      queueId: jsonGatilho.queueId,
                      chatbot: false,
                      useIntegration: false,
                      integrationId: null
                    },
                    ticketId: ticket.id,
                    companyId: ticket.companyId
                  });

                  return;
                }

                if (
                  !isNil(jsonGatilho.queueId) &&
                  jsonGatilho.queueId > 0 &&
                  !isNil(jsonGatilho.userId) &&
                  jsonGatilho.userId > 0
                ) {
                  await UpdateTicketService({
                    ticketData: {
                      queueId: jsonGatilho.queueId,
                      userId: jsonGatilho.userId,
                      chatbot: false,
                      useIntegration: false,
                      integrationId: null
                    },
                    ticketId: ticket.id,
                    companyId: ticket.companyId
                  });

                  return;
                }
              } catch (err) {
                throw err;
              }
            }

            await wbot.presenceSubscribe(msg.key.remoteJid);
            //await delay(2000)
            await wbot.sendPresenceUpdate("composing", msg.key.remoteJid);
            await delay(typebotDelayMessage);
            await wbot.sendPresenceUpdate("paused", msg.key.remoteJid);

            await sendBaileysSocketMessage(wbot, msg.key.remoteJid, {
              text: formattedText
            });
          }

          if (message.type === "audio") {
            await wbot.presenceSubscribe(msg.key.remoteJid);
            //await delay(2000)
            await wbot.sendPresenceUpdate("composing", msg.key.remoteJid);
            await delay(typebotDelayMessage);
            await wbot.sendPresenceUpdate("paused", msg.key.remoteJid);
            const media = {
              audio: {
                url: message.content.url,
                mimetype: "audio/mp4",
                ptt: true
              }
            };
            await sendBaileysSocketMessage(wbot, msg.key.remoteJid, media);
          }

          // if (message.type === 'embed') {
          //     await wbot.presenceSubscribe(msg.key.remoteJid)
          //     //await delay(2000)
          //     await wbot.sendPresenceUpdate('composing', msg.key.remoteJid)
          //     await delay(typebotDelayMessage)
          //     await wbot.sendPresenceUpdate('paused', msg.key.remoteJid)
          //     const media = {

          //         document: { url: message.content.url },
          //         mimetype: 'application/pdf',
          //         caption: ""

          //     }
          //     await sendBaileysSocketMessage(wbot, msg.key.remoteJid, media);
          // }

          if (message.type === "image") {
            await wbot.presenceSubscribe(msg.key.remoteJid);
            //await delay(2000)
            await wbot.sendPresenceUpdate("composing", msg.key.remoteJid);
            await delay(typebotDelayMessage);
            await wbot.sendPresenceUpdate("paused", msg.key.remoteJid);
            const media = {
              image: {
                url: message.content.url
              }
            };
            await sendBaileysSocketMessage(wbot, msg.key.remoteJid, media);
          }

          // if (message.type === 'video' ) {
          //     await wbot.presenceSubscribe(msg.key.remoteJid)
          //     //await delay(2000)
          //     await wbot.sendPresenceUpdate('composing', msg.key.remoteJid)
          //     await delay(typebotDelayMessage)
          //     await wbot.sendPresenceUpdate('paused', msg.key.remoteJid)
          //     const media = {
          //         video: {
          //             url: message.content.url,
          //         },

          //     }
          //     await sendBaileysSocketMessage(wbot, msg.key.remoteJid, media);
          // }
        }
        if (input) {
          if (input.type === "choice input") {
            let formattedText = "";
            const items = input.items;
            for (const item of items) {
              formattedText += `▶️ ${item.content}\n`;
            }
            formattedText = formattedText.replace(/\n$/, "");
            await wbot.presenceSubscribe(msg.key.remoteJid);
            //await delay(2000)
            await wbot.sendPresenceUpdate("composing", msg.key.remoteJid);
            await delay(typebotDelayMessage);
            await wbot.sendPresenceUpdate("paused", msg.key.remoteJid);
            await sendBaileysSocketMessage(wbot, msg.key.remoteJid, {
              text: formattedText
            });
          }
        }
      }
    }
    if (body === typebotKeywordRestart) {
      await ticket.update({
        isBot: true,
        typebotSessionId: null
      } as any);

      await ticket.reload();

      await sendBaileysSocketMessage(wbot, `${number}@c.us`, {
        text: typebotRestartMessage
      });
    }
    if (body === typebotKeywordFinish) {
      await UpdateTicketService({
        ticketData: {
          status: "closed",
          useIntegration: false,
          integrationId: null
        },
        ticketId: ticket.id,
        companyId: ticket.companyId
      });

      return;
    }
  } catch (error) {
    logger.info("Error on typebotListener: ", error);
    await ticket.update({
      typebotSessionId: null
    });
    throw error;
  }
};

export default typebotListener;
