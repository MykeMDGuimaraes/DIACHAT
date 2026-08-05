import { v4 as uuidv4 } from "uuid";
import { lookup as lookupMimeType } from "mime-types";
import { IConnections, INodes } from "./DispatchWebHookService";
import Contact from "../../models/Contact";
//import CreateTicketService from "../TicketServices/CreateTicketService";
//import CreateTicketServiceWebhook from "../TicketServices/CreateTicketServiceWebhook";
import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import Ticket from "../../models/Ticket";
import {
  processAudio,
  processAudioFile,
  typeSimulation
} from "../WbotServices/SendWhatsAppMediaFlow";
import { randomizarCaminho } from "../../utils/randomizador";
import formatBody from "../../helpers/Mustache";
import SetTicketMessagesAsRead from "../../helpers/SetTicketMessagesAsRead";
import {
  OutboundMessageService,
  stageMessagingMedia,
  messageKindForFile
} from "../../messaging/public/outbound";
import ShowTicketService from "../TicketServices/ShowTicketService";
import { getIO } from "../../libs/socket";
import FindOrCreateATicketTrakingService from "../TicketServices/FindOrCreateATicketTrakingService";
import { logger } from "../../utils/logger";
///import CreateLogTicketService from "../TicketServices/CreateLogTicketService";
//import CompaniesSettings from "../../models/CompaniesSettings";
//import ShowWhatsAppService from "../WhatsappService/ShowWhatsAppService";
import { delay } from "bluebird";
import typebotListener from "../TypebotServices/typebotListener";
import { getWbot } from "../../libs/wbot";
import { proto } from "../../messaging/public/baileys";
import { handleOpenAi } from "../IntegrationsServices/OpenAiService";
import { IOpenAi } from "../../@types/openai";

// Automacoes de webhook tambem aceitam envios pelo nucleo do outbox
// (Task 4): cada mensagem de fluxo vira Message + comando + evento na
// mesma transacao, com entrega assincrona pelo dispatcher.
const outboundMessageService = new OutboundMessageService();

export const ActionsWebhookService = async (
  whatsappId: number,
  idFlowDb: number,
  companyId: number,
  nodes: INodes[],
  connects: IConnections[],
  nextStage: string,
  dataWebhook: any,
  details: any,
  hashWebhookId: string,
  pressKey?: string,
  idTicket?: number,
  numberPhrase: "" | { number: string; name: string; email: string } = "",
  msg?: proto.IWebMessageInfo
): Promise<string> => {
  try {
    const io = getIO();
    let next = nextStage;
    console.log(
      "ActionWebhookService | 53",
      idFlowDb,
      companyId,
      nodes,
      connects,
      nextStage,
      dataWebhook,
      details,
      hashWebhookId,
      pressKey,
      idTicket,
      numberPhrase
    );
    let createFieldJsonName = "";

    const connectStatic = connects;
    if (numberPhrase === "") {
      const nameInput = details.inputs.find(item => item.keyValue === "nome");
      nameInput.data.split(",").map(dataN => {
        const lineToData = details.keysFull.find(item => item === dataN);
        let sumRes = "";
        if (!lineToData) {
          sumRes = dataN;
        } else {
          sumRes = constructJsonLine(lineToData, dataWebhook);
        }
        createFieldJsonName = createFieldJsonName + sumRes;
      });
    } else {
      createFieldJsonName = numberPhrase.name;
    }

    let numberClient = "";

    if (numberPhrase === "") {
      const numberInput = details.inputs.find(
        item => item.keyValue === "celular"
      );

      numberInput.data.split(",").map(dataN => {
        const lineToDataNumber = details.keysFull.find(item => item === dataN);
        let createFieldJsonNumber = "";
        if (!lineToDataNumber) {
          createFieldJsonNumber = dataN;
        } else {
          createFieldJsonNumber = constructJsonLine(
            lineToDataNumber,
            dataWebhook
          );
        }

        numberClient = numberClient + createFieldJsonNumber;
      });
    } else {
      numberClient = numberPhrase.number;
    }

    numberClient = removerNaoLetrasNumeros(numberClient);

    if (numberClient.substring(0, 2) === "55") {
      if (parseInt(numberClient.substring(2, 4)) >= 31) {
        if (numberClient.length === 13) {
          numberClient =
            numberClient.substring(0, 4) + numberClient.substring(5, 13);
        }
      }
    }

    let createFieldJsonEmail = "";

    if (numberPhrase === "") {
      const emailInput = details.inputs.find(item => item.keyValue === "email");
      emailInput.data.split(",").map(dataN => {
        const lineToDataEmail = details.keysFull.find(item =>
          item.endsWith("email")
        );

        let sumRes = "";
        if (!lineToDataEmail) {
          sumRes = dataN;
        } else {
          sumRes = constructJsonLine(lineToDataEmail, dataWebhook);
        }

        createFieldJsonEmail = createFieldJsonEmail + sumRes;
      });
    } else {
      createFieldJsonEmail = numberPhrase.email;
    }

    const lengthLoop = nodes.length;
    const whatsapp = await GetDefaultWhatsApp(companyId);

    if (whatsapp.status !== "CONNECTED") {
      return;
    }

    let execCount = 0;

    let execFn = "";

    let ticket = null;

    let noAlterNext = false;

    for (var i = 0; i < lengthLoop; i++) {
      let nodeSelected: any;

      if (pressKey) {
        console.log("UPDATE2...");
        if (pressKey === "parar") {
          console.log("UPDATE3...");
          if (idTicket) {
            console.log("UPDATE4...");
            await Ticket.findOne({
              where: { id: idTicket, whatsappId }
            });
            await ticket.update({
              status: "closed"
            });
          }
          break;
        }

        if (execFn === "") {
          console.log("UPDATE5...");
          nodeSelected = {
            type: "menu"
          };
        } else {
          console.log("UPDATE6...");
          nodeSelected = nodes.filter(node => node.id === execFn)[0];
        }
      } else {
        console.log("UPDATE7...");
        const otherNode = nodes.filter(node => node.id === next)[0];
        if (otherNode) {
          nodeSelected = otherNode;
        }
      }

      if (nodeSelected.type === "message") {
        let messageNode;

        const webhook = ticket.dataWebhook;

        if (webhook && webhook.hasOwnProperty("variables")) {
          messageNode = {
            body: replaceMessages(webhook, nodeSelected.data.label)
          };
        } else {
          messageNode = {
            body: nodeSelected.data.label
          };
        }

        await outboundMessageService.create({
          companyId,
          whatsappId: whatsapp.id,
          recipient: numberClient,
          idempotencyScope: "automation-flow",
          idempotencyKey: uuidv4(),
          kind: "text",
          // O caractere invisivel do antigo SendMessage e preservado para
          // manter a paridade de exibicao das mensagens de fluxo.
          text: `‎ ${messageNode.body}`,
          origin: "automation"
        });

        //TESTE BOTÃO
        //await SendMessageFlow(whatsapp, {
        //  number: numberClient,
        //  body: msg.body
        //} )
        await intervalWhats("1");
      }
      console.log("273");
      if (nodeSelected.type === "typebot") {
        console.log("275");
        const wbot = getWbot(whatsapp.id);
        await typebotListener({
          wbot: wbot,
          msg,
          ticket,
          typebot: nodeSelected.data.typebotIntegration
        });
      }

      if (nodeSelected.type === "openai") {
        let {
          name,
          prompt,
          voice,
          voiceKey,
          voiceRegion,
          maxTokens,
          temperature,
          apiKey,
          queueId,
          maxMessages
        } = nodeSelected.data.typebotIntegration as IOpenAi;

        let openAiSettings = {
          name,
          prompt,
          voice,
          voiceKey,
          voiceRegion,
          maxTokens: parseInt(maxTokens),
          temperature: parseInt(temperature),
          apiKey,
          queueId: parseInt(queueId),
          maxMessages: parseInt(maxMessages)
        };

        const contact = await Contact.findOne({
          where: { number: numberClient, companyId }
        });

        const wbot = getWbot(whatsapp.id);

        const ticketTraking = await FindOrCreateATicketTrakingService({
          ticketId: ticket.id,
          companyId,
          userId: null,
          whatsappId: whatsapp?.id
        });

        await handleOpenAi(
          openAiSettings,
          msg,
          wbot,
          ticket,
          contact,
          null,
          ticketTraking
        );
      }

      if (nodeSelected.type === "question") {
        const variables = ticket?.dataWebhook?.variables;

        if (!variables || variables === undefined || variables === null) {
          const { message } = nodeSelected.data.typebotIntegration;
          const ticketDetails = await ShowTicketService(ticket.id, companyId);

          const bodyFila = formatBody(`${message}`, ticket.contact);

          await delay(3000);
          await typeSimulation(ticket, "composing");

          await outboundMessageService.create({
            companyId,
            ticketId: ticketDetails.id,
            idempotencyScope: "automation-flow",
            idempotencyKey: uuidv4(),
            kind: "text",
            text: bodyFila,
            origin: "automation"
          });

          SetTicketMessagesAsRead(ticketDetails);

          await ticketDetails.update({
            lastMessage: bodyFila
          });

          await ticket.update({
            userId: null,
            companyId: companyId,
            lastFlowId: nodeSelected.id,
            hashFlowId: hashWebhookId,
            flowStopped: idFlowDb.toString()
          });
        }
        break;
      }


      if (nodeSelected.type === "singleBlock") {
        for (var iLoc = 0; iLoc < nodeSelected.data.seq.length; iLoc++) {
          const elementNowSelected = nodeSelected.data.seq[iLoc];

          ticket = await Ticket.findOne({
            where: { id: idTicket, companyId }
          });

          if (elementNowSelected.includes("message")) {
            const bodyFor = nodeSelected.data.elements.filter(
              item => item.number === elementNowSelected
            )[0].value;

            const ticketDetails = await ShowTicketService(idTicket, companyId);

            let messageBody;

            const webhook = ticket.dataWebhook;

            if (webhook && webhook.hasOwnProperty("variables")) {
              messageBody = replaceMessages(webhook.variables, bodyFor);
            } else {
              messageBody = bodyFor;
            }

            await delay(3000);
            await typeSimulation(ticket, "composing");

            await outboundMessageService.create({
              companyId,
              ticketId: ticketDetails.id,
              idempotencyScope: "automation-flow",
              idempotencyKey: uuidv4(),
              kind: "text",
              text: formatBody(messageBody, ticketDetails.contact),
              origin: "automation"
            });

            SetTicketMessagesAsRead(ticketDetails);

            await ticketDetails.update({
              lastMessage: formatBody(bodyFor, ticket.contact)
            });

            await intervalWhats("1");
          }
          if (elementNowSelected.includes("interval")) {
            await intervalWhats(
              nodeSelected.data.elements.filter(
                item => item.number === elementNowSelected
              )[0].value
            );
          }

          if (elementNowSelected.includes("img")) {
            await typeSimulation(ticket, "composing");

            const flowImagePath = process.env.BACKEND_URL.includes(
              "http://localhost"
            )
              ? `${__dirname.split("src")[0].split("\\").join("/")}public/${
                  nodeSelected.data.elements.filter(
                    item => item.number === elementNowSelected
                  )[0].value
                }`
              : `${__dirname.split("dist")[0].split("\\").join("/")}public/${
                  nodeSelected.data.elements.filter(
                    item => item.number === elementNowSelected
                  )[0].value
                }`;
            // O asset do fluxo permanece na pasta public: copia duravel
            // para storage/messaging antes de enfileirar.
            const stagedImage = await stageMessagingMedia(flowImagePath);

            await outboundMessageService.create({
              companyId,
              whatsappId: whatsapp.id,
              recipient: numberClient,
              idempotencyScope: "automation-flow",
              idempotencyKey: uuidv4(),
              kind: messageKindForFile(flowImagePath),
              payload: { localPath: stagedImage },
              origin: "automation"
            });
            await intervalWhats("1");
          }

          if (elementNowSelected.includes("audio")) {
            const flowAudioElement = nodeSelected.data.elements.filter(
              item => item.number === elementNowSelected
            )[0];
            const mediaDirectory =
              process.env.BACKEND_URL === "http://localhost:8090"
                ? `${__dirname.split("src")[0].split("\\").join("/")}public/${
                    flowAudioElement.value
                  }`
                : `${__dirname.split("dist")[0].split("\\").join("/")}public/${
                    flowAudioElement.value
                  }`;

            await typeSimulation(ticket, "recording");

            // Preserva a normalizacao ffmpeg do fluxo (voice note ptt vs
            // arquivo de audio) antes da copia duravel para o outbox.
            const convertedAudio = flowAudioElement.record
              ? await processAudio(mediaDirectory)
              : await processAudioFile(mediaDirectory);
            const stagedAudio = await stageMessagingMedia(convertedAudio);

            await outboundMessageService.create({
              companyId,
              whatsappId: whatsapp.id,
              recipient: numberClient,
              idempotencyScope: "automation-flow",
              idempotencyKey: uuidv4(),
              kind: "audio",
              payload: {
                localPath: stagedAudio,
                mimeType: "audio/mp4",
                ptt: Boolean(flowAudioElement.record)
              },
              origin: "automation"
            });
            await intervalWhats("1");
          }
          if (elementNowSelected.includes("video")) {
            const flowVideoElement = nodeSelected.data.elements.filter(
              item => item.number === elementNowSelected
            )[0];
            const mediaDirectory =
              process.env.BACKEND_URL === "http://localhost:8090"
                ? `${__dirname.split("src")[0].split("\\").join("/")}public/${
                    flowVideoElement.value
                  }`
                : `${__dirname.split("dist")[0].split("\\").join("/")}public/${
                    flowVideoElement.value
                  }`;

            await typeSimulation(ticket, "recording");

            // Copia duravel para o outbox: o dispatcher pode enviar minutos
            // depois, quando o asset precisa continuar acessivel.
            const stagedVideo = await stageMessagingMedia(mediaDirectory);

            await outboundMessageService.create({
              companyId,
              whatsappId: whatsapp.id,
              recipient: numberClient,
              idempotencyScope: "automation-flow",
              idempotencyKey: uuidv4(),
              kind: "video",
              payload: {
                localPath: stagedVideo,
                mimeType: lookupMimeType(mediaDirectory) || "video/mp4"
              },
              origin: "automation"
            });
            await intervalWhats("1");
          }
        }
      }

      let isRandomizer: boolean;
      if (nodeSelected.type === "randomizer") {
        const selectedRandom = randomizarCaminho(
          nodeSelected.data.percent / 100
        );

        const resultConnect = connects.filter(
          connect => connect.source === nodeSelected.id
        );
        if (selectedRandom === "A") {
          next = resultConnect.filter(item => item.sourceHandle === "a")[0]
            .target;
          noAlterNext = true;
        } else {
          next = resultConnect.filter(item => item.sourceHandle === "b")[0]
            .target;
          noAlterNext = true;
        }
        isRandomizer = true;
      }

      let isMenu: boolean;

      if (nodeSelected.type === "menu") {
        console.log(650, "menu");
        if (pressKey) {
          const filterOne = connectStatic.filter(
            confil => confil.source === next
          );
          const filterTwo = filterOne.filter(
            filt2 => filt2.sourceHandle === "a" + pressKey
          );
          if (filterTwo.length > 0) {
            execFn = filterTwo[0].target;
          } else {
            execFn = undefined;
          }
          // execFn =
          //   connectStatic
          //     .filter(confil => confil.source === next)
          //     .filter(filt2 => filt2.sourceHandle === "a" + pressKey)[0]?.target ??
          //   undefined;
          if (execFn === undefined) {
            break;
          }
          pressKey = "999";

          const isNodeExist = nodes.filter(item => item.id === execFn);
          console.log(674, "menu");
          if (isNodeExist.length > 0) {
            isMenu = isNodeExist[0].type === "menu" ? true : false;
          } else {
            isMenu = false;
          }
        } else {
          console.log(681, "menu");
          let optionsMenu = "";
          nodeSelected.data.arrayOption.map(item => {
            optionsMenu += `[${item.number}] ${item.value}\n`;
          });

          const menuCreate = `${nodeSelected.data.message}\n\n${optionsMenu}`;

          const webhook = ticket.dataWebhook;

          let menuMessage;
          if (webhook && webhook.hasOwnProperty("variables")) {
            menuMessage = {
              body: replaceMessages(webhook, menuCreate),
              number: numberClient,
              companyId: companyId
            };
          } else {
            menuMessage = {
              body: menuCreate,
              number: numberClient,
              companyId: companyId
            };
          }

          const ticketDetails = await ShowTicketService(ticket.id, companyId);

          await typeSimulation(ticket, "composing");

          await outboundMessageService.create({
            companyId,
            ticketId: ticketDetails.id,
            idempotencyScope: "automation-flow",
            idempotencyKey: uuidv4(),
            kind: "text",
            text: formatBody(menuMessage.body, ticketDetails.contact),
            origin: "automation"
          });

          SetTicketMessagesAsRead(ticketDetails);

          await ticketDetails.update({
            lastMessage: formatBody(menuMessage.body, ticket.contact)
          });
          await intervalWhats("1");

          if (ticket) {
            ticket = await Ticket.findOne({
              where: {
                id: ticket.id,
                whatsappId: whatsappId,
                companyId: companyId
              }
            });
          } else {
            ticket = await Ticket.findOne({
              where: {
                id: idTicket,
                whatsappId: whatsappId,
                companyId: companyId
              }
            });
          }

          if (ticket) {
            await ticket.update({
              queueId: ticket.queueId ? ticket.queueId : null,
              userId: null,
              companyId: companyId,
              flowWebhook: true,
              lastFlowId: nodeSelected.id,
              dataWebhook: dataWebhook,
              hashFlowId: hashWebhookId,
              flowStopped: idFlowDb.toString()
            });
          }

          break;
        }
      }

      let isContinue = false;

      if (pressKey === "999" && execCount > 0) {
        console.log(587, "ActionsWebhookService | 587");

        pressKey = undefined;
        let result = connects.filter(connect => connect.source === execFn)[0];
        if (typeof result === "undefined") {
          next = "";
        } else {
          if (!noAlterNext) {
            next = result.target;
          }
        }
      } else {
        let result;

        if (isMenu) {
          result = { target: execFn };
          isContinue = true;
          pressKey = undefined;
        } else if (isRandomizer) {
          isRandomizer = false;
          result = next;
        } else {
          result = connects.filter(connect => connect.source === next)[0];
        }

        if (typeof result === "undefined") {
          next = "";
        } else {
          if (!noAlterNext) {
            next = result.target;
          }
        }
        console.log(619, "ActionsWebhookService");
      }

      if (!pressKey && !isContinue) {
        const nextNode = connects.filter(
          connect => connect.source === nodeSelected.id
        ).length;

        console.log(626, "ActionsWebhookService");

        if (nextNode === 0) {
          console.log(654, "ActionsWebhookService");

          await Ticket.findOne({
            where: { id: idTicket, whatsappId, companyId: companyId }
          });
          await ticket.update({
            lastFlowId: nodeSelected.id,
            hashFlowId: null,
            flowWebhook: false,
            flowStopped: idFlowDb.toString()
          });
          break;
        }
      }

      isContinue = false;

      if (next === "") {
        break;
      }

      console.log(678, "ActionsWebhookService");

      console.log("UPDATE10...");
      ticket = await Ticket.findOne({
        where: { id: idTicket, whatsappId, companyId: companyId }
      });

      if (ticket.status === "closed") {
        io.of(String(companyId))
          // .to(oldStatus)
          // .to(ticketId.toString())
          .emit(`company-${ticket.companyId}-ticket`, {
            action: "delete",
            ticketId: ticket.id
          });
      }

      console.log("UPDATE12...");
      await ticket.update({
        whatsappId: whatsappId,
        queueId: ticket?.queueId,
        userId: null,
        companyId: companyId,
        flowWebhook: true,
        lastFlowId: nodeSelected.id,
        hashFlowId: hashWebhookId,
        flowStopped: idFlowDb.toString()
      });

      noAlterNext = false;
      execCount++;
    }

    return "ds";
  } catch (error) {
    logger.error(error);
  }
};

const constructJsonLine = (line: string, json: any) => {
  let valor = json;
  const chaves = line.split(".");

  if (chaves.length === 1) {
    return valor[chaves[0]];
  }

  for (const chave of chaves) {
    valor = valor[chave];
  }
  return valor;
};

function removerNaoLetrasNumeros(texto: string) {
  // Substitui todos os caracteres que não são letras ou números por vazio
  return texto.replace(/[^a-zA-Z0-9]/g, "");
}

const intervalWhats = (time: string) => {
  const seconds = parseInt(time) * 1000;
  return new Promise(resolve => setTimeout(resolve, seconds));
};

const replaceMessages = (variables, message) => {
  return message.replace(
    /{{\s*([^{}\s]+)\s*}}/g,
    (match, key) => variables[key] || ""
  );
};
