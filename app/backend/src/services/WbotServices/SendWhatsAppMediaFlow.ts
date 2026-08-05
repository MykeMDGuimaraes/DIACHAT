import { exec } from "child_process";
import path from "path";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import { WAPresence, resolveContactJid } from "../../messaging/public/baileys";
import GetTicketWbot from "../../helpers/GetTicketWbot";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";

const publicFolder = path.resolve(__dirname, "..", "..", "..", "public");

export const processAudio = async (audio: string): Promise<string> => {
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

export const processAudioFile = async (audio: string): Promise<string> => {
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
