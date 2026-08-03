import { resolveContactJid, sendBaileysSocketMessage } from "../../messaging/public/baileys";
import {
  WAMessage,
  AnyMessageContent,
  WAPresence
} from "../../messaging/public/baileys";
import * as Sentry from "@sentry/node";
import fs from "fs";
import { exec } from "child_process";
import path from "path";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import mime from "mime-types";
import AppError from "../../errors/AppError";
import GetTicketWbot from "../../helpers/GetTicketWbot";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";

interface RequestFlow {
  media: string;
  ticket: Ticket;
  body?: string;
  isFlow?: boolean;
  isRecord?: boolean;
}

const publicFolder = path.resolve(__dirname, "..", "..", "..", "public");

const processAudio = async (audio: string): Promise<string> => {
  const outputAudio = `${publicFolder}/${new Date().getTime()}.mp3`;
  return new Promise((resolve, reject) => {
    exec(
      `${ffmpegPath.path} -i ${audio} -vn -ab 128k -ar 44100 -f ipod ${outputAudio} -y`,
      (error, _stdout, _stderr) => {
        if (error) reject(error);
        // fs.unlinkSync(audio);
        resolve(outputAudio);
      }
    );
  });
};

const processAudioFile = async (audio: string): Promise<string> => {
  const outputAudio = `${publicFolder}/${new Date().getTime()}.mp3`;
  return new Promise((resolve, reject) => {
    exec(
      `${ffmpegPath.path} -i ${audio} -vn -ar 44100 -ac 2 -b:a 192k ${outputAudio}`,
      (error, _stdout, _stderr) => {
        if (error) reject(error);
        // fs.unlinkSync(audio);
        resolve(outputAudio);
      }
    );
  });
};

const nameFileDiscovery = (pathMedia: string) => {
  const spliting = pathMedia.split("/");
  const first = spliting[spliting.length - 1];
  return first.split(".")[0];
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export const typeSimulation = async (ticket: Ticket, presence: WAPresence) => {
  const wbot = await GetTicketWbot(ticket);

  const contact = await Contact.findOne({
    where: {
      id: ticket.contactId
    }
  });

  await wbot.sendPresenceUpdate(
    presence,
    resolveContactJid({ ...contact, isGroup: ticket.isGroup })
  );
  await delay(5000);
  await wbot.sendPresenceUpdate(
    "paused",
    resolveContactJid({ ...contact, isGroup: ticket.isGroup })
  );
};

const SendWhatsAppMediaFlow = async ({
  media,
  ticket,
  body,
  isRecord = false
}: RequestFlow): Promise<WAMessage> => {
  try {
    const wbot = await GetTicketWbot(ticket);

    const mimetype = mime.lookup(media);
    const pathMedia = media;

    let typeMessage = "";

    if (typeof mimetype === "string") {
      typeMessage = mimetype.split("/")[0];
    }
    const mediaName = nameFileDiscovery(media);

    let options: AnyMessageContent;

    if (mimetype) {
      if (typeMessage === "video") {
        options = {
          video: fs.readFileSync(pathMedia),
          caption: body,
          fileName: mediaName
          // gifPlayback: true
        };
      } else if (typeMessage === "audio") {
        console.log("record", isRecord);
        if (isRecord) {
          const convert = await processAudio(pathMedia);
          options = {
            audio: fs.readFileSync(convert),
            mimetype: typeMessage ? "audio/mp4" : mimetype,
            ptt: true
          };
        } else {
          const convert = await processAudioFile(pathMedia);
          options = {
            audio: fs.readFileSync(convert),
            mimetype: typeMessage ? "audio/mp4" : mimetype,
            ptt: false
          };
        }
      } else if (typeMessage === "document" || typeMessage === "text") {
        options = {
          document: fs.readFileSync(pathMedia),
          caption: body,
          fileName: mediaName,
          mimetype
        };
      } else if (typeMessage === "application") {
        options = {
          document: fs.readFileSync(pathMedia),
          caption: body,
          fileName: mediaName,
          mimetype
        };
      }
    } else {
      options = {
        image: fs.readFileSync(pathMedia),
        caption: body
      };
    }

    const contact = await Contact.findOne({
      where: {
        id: ticket.contactId
      }
    });

    const sentMessage = await sendBaileysSocketMessage(
      wbot,
      resolveContactJid({ ...contact, isGroup: ticket.isGroup }),
      {
        ...options
      }
    );

    await ticket.update({ lastMessage: mediaName });

    return sentMessage;
  } catch (err) {
    Sentry.captureException(err);
    console.log(err);
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }
};

export default SendWhatsAppMediaFlow;
