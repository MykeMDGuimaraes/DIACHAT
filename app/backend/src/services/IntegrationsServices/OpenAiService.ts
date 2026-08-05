import { v4 as uuidv4 } from "uuid";
import { proto, WASocket } from "../../messaging/public/baileys";
import {
  convertTextToSpeechAndSaveToFile,
  getBodyMessage,
  keepOnlySpecifiedChars,
  transferQueue
} from "../WbotServices/wbotMessageListener";

import fs from "fs";
import path from "path";

import { Configuration, OpenAIApi } from "openai";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import TicketTraking from "../../models/TicketTraking";
import {
  OutboundMessageService,
  stageMessagingMedia
} from "../../messaging/public/outbound";
import { logger } from "../../utils/logger";

const outboundMessageService = new OutboundMessageService();

type Session = WASocket & {
  id?: number;
};

interface SessionOpenAi extends OpenAIApi {
  id?: number;
}
const sessionsOpenAi: SessionOpenAi[] = [];

interface IOpenAi {
  name: string;
  prompt: string;
  voice: string;
  voiceKey: string;
  voiceRegion: string;
  maxTokens: number;
  temperature: number;
  apiKey: string;
  queueId: number;
  maxMessages: number;
}

const deleteFileSync = (filePath: string): void => {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    console.error("Erro ao deletar o arquivo:", error);
  }
};

const sanitizeName = (name: string): string => {
  let sanitized = name.split(" ")[0];
  sanitized = sanitized.replace(/[^a-zA-Z0-9]/g, "");
  return sanitized.substring(0, 60);
};

export const handleOpenAi = async (
  openAiSettings: IOpenAi,
  msg: proto.IWebMessageInfo,
  wbot: Session,
  ticket: Ticket,
  contact: Contact,
  mediaSent: Message | undefined,
  _ticketTraking: TicketTraking
): Promise<void> => {
  // REGRA PARA DESABILITAR O BOT PARA ALGUM CONTATO
  if (contact.disableBot) {
    return;
  }

  const bodyMessage = getBodyMessage(msg);
  if (!bodyMessage) return;
  // console.log("GETTING WHATSAPP HANDLE OPENAI", ticket.whatsappId, ticket.id)

  if (!openAiSettings) return;

  if (msg.messageStubType) return;

  const publicFolder: string = path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "public",
    `company${ticket.companyId}`
  );

  let openai: OpenAIApi | any;
  const openAiIndex = sessionsOpenAi.findIndex(s => s.id === ticket.id);

  if (openAiIndex === -1) {
    const configuration = new Configuration({
      apiKey: openAiSettings.apiKey
    });
    openai = new OpenAIApi(configuration);
    openai.id = ticket.id;
    sessionsOpenAi.push(openai);
  } else {
    openai = sessionsOpenAi[openAiIndex];
  }

  const messages = await Message.findAll({
    where: { ticketId: ticket.id },
    order: [["createdAt", "ASC"]],
    limit: openAiSettings.maxMessages
  });

  const promptSystem = `Nas respostas utilize o nome ${sanitizeName(
    contact.name || "Amigo(a)"
  )} para identificar o cliente.\nSua resposta deve usar no máximo ${
    openAiSettings.maxTokens
  } tokens e cuide para não truncar o final.\nSempre que possível, mencione o nome dele para ser mais personalizado o atendimento e mais educado. Quando a resposta requer uma transferência para o setor de atendimento, comece sua resposta com 'Ação: Transferir para o setor de atendimento'.\n
                ${openAiSettings.prompt}\n`;

  let messagesOpenAi = [];

  if (msg.message?.conversation || msg.message?.extendedTextMessage?.text) {
    console.log(135, "OpenAiService");
    messagesOpenAi = [];
    messagesOpenAi.push({ role: "system", content: promptSystem });
    for (
      let i = 0;
      i < Math.min(openAiSettings.maxMessages, messages.length);
      i++
    ) {
      const message = messages[i];
      if (
        message.mediaType === "conversation" ||
        message.mediaType === "extendedTextMessage"
      ) {
        if (message.fromMe) {
          messagesOpenAi.push({ role: "assistant", content: message.body });
        } else {
          messagesOpenAi.push({ role: "user", content: message.body });
        }
      }
    }
    messagesOpenAi.push({ role: "user", content: bodyMessage! });

    console.log(156, "OpenAiService");

    const chat = await openai.createChatCompletion({
      model: "gpt-3.5-turbo-1106",
      messages: messagesOpenAi,
      max_tokens: openAiSettings.maxTokens,
      temperature: openAiSettings.temperature
    });

    let response = chat.data.choices[0].message?.content;

    if (response?.includes("Ação: Transferir para o setor de atendimento")) {
      console.log(166, "OpenAiService");
      await transferQueue(openAiSettings.queueId, ticket, contact);
      response = response
        .replace("Ação: Transferir para o setor de atendimento", "")
        .trim();
    }

    if (openAiSettings.voice === "texto") {
      console.log(173, "OpenAiService");
      logger.info(chat.data.choices[0].message);
      logger.info(response);
      await outboundMessageService.create({
        companyId: ticket.companyId,
        ticketId: ticket.id,
        idempotencyScope: "prompt-openai-text",
        idempotencyKey: uuidv4(),
        kind: "text",
        text: `\u200e ${response!}`,
        origin: "automation"
      });
    } else {
      console.log(179, "OpenAiService");
      const fileNameWithOutExtension = `${ticket.id}_${Date.now()}`;
      convertTextToSpeechAndSaveToFile(
        keepOnlySpecifiedChars(response!),
        `${publicFolder}/${fileNameWithOutExtension}`,
        openAiSettings.voiceKey,
        openAiSettings.voiceRegion,
        openAiSettings.voice,
        "mp3"
      ).then(async () => {
        try {
          console.log(194, "OpenAiService");
          const localPath = await stageMessagingMedia(
            `${publicFolder}/${fileNameWithOutExtension}.mp3`,
            `${fileNameWithOutExtension}.mp3`
          );
          await outboundMessageService.create({
            companyId: ticket.companyId,
            ticketId: ticket.id,
            idempotencyScope: "prompt-openai-tts",
            idempotencyKey: uuidv4(),
            kind: "audio",
            payload: { localPath, mimeType: "audio/mpeg", ptt: true },
            origin: "automation"
          });
          deleteFileSync(`${publicFolder}/${fileNameWithOutExtension}.mp3`);
          deleteFileSync(`${publicFolder}/${fileNameWithOutExtension}.wav`);
        } catch (error) {
          console.log(`Erro para responder com audio: ${error}`);
        }
      });
    }
  } else if (msg.message?.audioMessage) {
    console.log(201, "OpenAiService");
    const mediaUrl = mediaSent!.mediaUrl!.split("/").pop();
    const file = fs.createReadStream(`${publicFolder}/${mediaUrl}`) as any;

    const transcription = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file: file
    });

    messagesOpenAi = [];
    messagesOpenAi.push({ role: "system", content: promptSystem });
    for (
      let i = 0;
      i < Math.min(openAiSettings.maxMessages, messages.length);
      i++
    ) {
      const message = messages[i];
      if (
        message.mediaType === "conversation" ||
        message.mediaType === "extendedTextMessage"
      ) {
        console.log(238, "OpenAiService");

        if (message.fromMe) {
          messagesOpenAi.push({ role: "assistant", content: message.body });
        } else {
          messagesOpenAi.push({ role: "user", content: message.body });
        }
      }
    }
    messagesOpenAi.push({ role: "user", content: transcription.text });
    const chat = await openai.chat.completions.create({
      model: "gpt-3.5-turbo-1106",
      messages: messagesOpenAi,
      max_tokens: openAiSettings.maxTokens,
      temperature: openAiSettings.temperature
    });
    let response = chat.choices[0].message?.content;

    if (response?.includes("Ação: Transferir para o setor de atendimento")) {
      await transferQueue(openAiSettings.queueId, ticket, contact);
      response = response
        .replace("Ação: Transferir para o setor de atendimento", "")
        .trim();
    }
    if (openAiSettings.voice === "texto") {
      await outboundMessageService.create({
        companyId: ticket.companyId,
        ticketId: ticket.id,
        idempotencyScope: "prompt-openai-text",
        idempotencyKey: uuidv4(),
        kind: "text",
        text: `\u200e ${response!}`,
        origin: "automation"
      });
    } else {
      const fileNameWithOutExtension = `${ticket.id}_${Date.now()}`;
      convertTextToSpeechAndSaveToFile(
        keepOnlySpecifiedChars(response!),
        `${publicFolder}/${fileNameWithOutExtension}`,
        openAiSettings.voiceKey,
        openAiSettings.voiceRegion,
        openAiSettings.voice,
        "mp3"
      ).then(async () => {
        try {
          const localPath = await stageMessagingMedia(
            `${publicFolder}/${fileNameWithOutExtension}.mp3`,
            `${fileNameWithOutExtension}.mp3`
          );
          await outboundMessageService.create({
            companyId: ticket.companyId,
            ticketId: ticket.id,
            idempotencyScope: "prompt-openai-tts",
            idempotencyKey: uuidv4(),
            kind: "audio",
            payload: { localPath, mimeType: "audio/mpeg", ptt: true },
            origin: "automation"
          });
          deleteFileSync(`${publicFolder}/${fileNameWithOutExtension}.mp3`);
          deleteFileSync(`${publicFolder}/${fileNameWithOutExtension}.wav`);
        } catch (error) {
          console.log(`Erro para responder com audio: ${error}`);
        }
      });
    }
  }
  messagesOpenAi = [];
};
