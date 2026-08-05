import { Request, Response } from "express";
import { UniqueConstraintError } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import AppError from "../errors/AppError";
import V1MessageIdempotency from "../models/V1MessageIdempotency";

import SetTicketMessagesAsRead from "../helpers/SetTicketMessagesAsRead";
import { getIO } from "../libs/socket";
import Message from "../models/Message";
import Queue from "../models/Queue";
import Ticket from "../models/Ticket";
import User from "../models/User";
import Whatsapp from "../models/Whatsapp";
import formatBody from "../helpers/Mustache";

import ListMessagesService from "../services/MessageServices/ListMessagesService";
import ShowTicketService from "../services/TicketServices/ShowTicketService";
import FindOrCreateTicketService from "../services/TicketServices/FindOrCreateTicketService";
import UpdateTicketService from "../services/TicketServices/UpdateTicketService";
import DeleteWhatsAppMessage from "../services/WbotServices/DeleteWhatsAppMessage";
import CheckContactNumber from "../services/WbotServices/CheckNumber";
import GetProfilePicUrl from "../services/WbotServices/GetProfilePicUrl";
import CreateOrUpdateContactService from "../services/ContactServices/CreateOrUpdateContactService";
import GetTicketWbot from "../helpers/GetTicketWbot";
import {
  OutboundMessageService,
  persistMessagingUpload,
  messageKindForMime
} from "../messaging/public/outbound";
import { notifyCreatedMessage } from "../services/MessageServices/CreateMessageService";

// Nucleo unico de aceitacao de envios (Task 4): todo envio da tela/API
// interna vira Message + MessageCommand + evento de outbox na mesma
// transacao; a entrega acontece no dispatcher (202 = aceito, nao enviado).
const outboundMessageService = new OutboundMessageService();

// A Message criada upfront precisa aparecer na tela imediatamente: o eco
// fromMe nao emite (key.id == commandId, Message ja existe), entao o
// controller publica o mesmo evento do CreateMessageService.
const emitUpfrontMessage = async (
  messageId: string,
  companyId: number
): Promise<void> => {
  const full = await Message.findByPk(messageId, {
    include: [
      "contact",
      {
        model: Ticket,
        as: "ticket",
        include: [
          "contact",
          "queue",
          { model: Whatsapp, as: "whatsapp", attributes: ["name"] }
        ]
      },
      { model: Message, as: "quotedMsg", include: ["contact"] }
    ]
  });
  if (full) {
    notifyCreatedMessage(full, companyId);
  }
};

type IndexQuery = {
  pageNumber: string;
};

type MessageData = {
  body: string;
  fromMe: boolean;
  read: boolean;
  quotedMsg?: Message;
  number?: string;
  closeTicket?: true;
  clientMessageId?: string;
  clientBatchId?: string;
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { ticketId } = req.params;
  const { pageNumber } = req.query as IndexQuery;
  const { companyId, profile } = req.user;
  const queues: number[] = [];

  if (profile !== "admin") {
    const user = await User.findByPk(req.user.id, {
      include: [{ model: Queue, as: "queues" }]
    });
    user.queues.forEach(queue => {
      queues.push(queue.id);
    });
  }

  const { count, messages, ticket, hasMore } = await ListMessagesService({
    pageNumber,
    ticketId,
    companyId,
    queues
  });

  SetTicketMessagesAsRead(ticket);

  return res.json({ count, messages, ticket, hasMore });
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { ticketId } = req.params;
  const { body, quotedMsg, clientMessageId, clientBatchId }: MessageData =
    req.body;
  const medias = req.files as Express.Multer.File[];
  const { companyId } = req.user;

  const ticket = await ShowTicketService(ticketId, companyId);

  SetTicketMessagesAsRead(ticket);

  if (medias && medias.length > 0) {
    // Lote de midia: upload duravel ANTES de enfileirar e chaves
    // deterministicas clientBatchId:{index} — um retry do lote inteiro
    // nao duplica nenhum anexo.
    const batchId =
      typeof clientBatchId === "string" &&
      clientBatchId.trim().length > 0 &&
      clientBatchId.length <= 191
        ? clientBatchId
        : uuidv4();
    const commands = await medias.reduce(
      async (
        accPromise: Promise<any[]>,
        media: Express.Multer.File,
        mediaIndex: number
      ) => {
        const acc = await accPromise;
        const semanticPayload = {
          caption: Array.isArray(body) ? body[mediaIndex] : body,
          fileName: media.originalname,
          mimeType: media.mimetype
        };
        // Replay ANTES do staging: um retry do lote nao move o arquivo de
        // novo nem diverge o fingerprint (localPath novo seria aleatorio).
        const replay = await outboundMessageService.findReplay({
          companyId,
          ticketId: ticket.id,
          idempotencyScope: "screen-media",
          idempotencyKey: `${batchId}:${mediaIndex}`,
          kind: messageKindForMime(media.mimetype),
          payload: semanticPayload,
          quotedMessageId: quotedMsg?.id,
          origin: "screen"
        });
        if (replay) {
          return [
            ...acc,
            {
              commandId: replay.command.id,
              messageId: replay.command.messageId,
              status: replay.command.status,
              replayed: true
            }
          ];
        }
        const localPath = await persistMessagingUpload(media);
        const { command, replayed } = await outboundMessageService.create({
          companyId,
          ticketId: ticket.id,
          idempotencyScope: "screen-media",
          idempotencyKey: `${batchId}:${mediaIndex}`,
          kind: messageKindForMime(media.mimetype),
          payload: { localPath, ...semanticPayload },
          quotedMessageId: quotedMsg?.id,
          origin: "screen"
        });
        if (!replayed) {
          await emitUpfrontMessage(command.messageId, companyId);
        }
        return [
          ...acc,
          {
            commandId: command.id,
            messageId: command.messageId,
            status: command.status,
            replayed
          }
        ];
      },
      Promise.resolve([] as any[])
    );
    return res.status(202).json({ commands });
  }

  // Ponte de compatibilidade: chaves registradas pelo mecanismo anterior
  // (envio sincrono) continuam respondendo sem reenviar.
  if (clientMessageId && typeof clientMessageId === "string") {
    if (clientMessageId.length > 191) {
      throw new AppError("clientMessageId inválido", 400);
    }
    const legacy = await V1MessageIdempotency.findOne({
      where: { companyId, ticketId: ticket.id, clientMessageId }
    });
    if (legacy && legacy.messageId) {
      return res.status(202).json({
        commandId: legacy.messageId,
        messageId: legacy.messageId,
        status: "sent",
        replayed: true
      });
    }
    if (legacy && !legacy.messageId) {
      // Envio original da era sincrona ainda em voo: retry duplicaria.
      throw new AppError("ERR_SEND_IN_PROGRESS", 409);
    }
  }

  const idempotencyKey =
    clientMessageId && typeof clientMessageId === "string"
      ? clientMessageId
      : uuidv4();
  const { command, replayed } = await outboundMessageService.create({
    companyId,
    ticketId: ticket.id,
    idempotencyScope: "screen",
    idempotencyKey,
    kind: "text",
    text: body,
    quotedMessageId: quotedMsg?.id,
    origin: "screen"
  });

  if (clientMessageId && typeof clientMessageId === "string" && !replayed) {
    // A tabela antiga permanece como ponte ate todos os clientes
    // tratarem o 202; a autoridade de deduplicacao e o MessageCommand.
    await V1MessageIdempotency.create({
      companyId,
      ticketId: ticket.id,
      clientMessageId,
      messageId: command.id
    } as any).catch(err => {
      if (!(err instanceof UniqueConstraintError)) throw err;
    });
  }
  if (!replayed) {
    await emitUpfrontMessage(command.messageId, companyId);
  }

  return res.status(202).json({
    commandId: command.id,
    messageId: command.messageId,
    status: command.status,
    replayed
  });
};

export const remove = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { messageId } = req.params;
  const { companyId } = req.user;

  const message = await DeleteWhatsAppMessage(messageId);

  const io = getIO();
  io.to(message.ticketId.toString()).emit(`company-${companyId}-appMessage`, {
    action: "update",
    message
  });

  return res.send();
};

export const send = async (req: Request, res: Response): Promise<Response> => {
  const { whatsappId } = req.params as unknown as { whatsappId: number };
  const messageData: MessageData = req.body;
  const medias = req.files as Express.Multer.File[];

  try {
    const whatsapp = await Whatsapp.findByPk(whatsappId);

    if (!whatsapp) {
      throw new Error("Não foi possível realizar a operação");
    }

    if (messageData.number === undefined) {
      throw new Error("O número é obrigatório");
    }

    const numberToTest = messageData.number;
    const { body } = messageData;

    const { companyId } = whatsapp;

    const CheckValidNumber = await CheckContactNumber(numberToTest, companyId);
    const number = CheckValidNumber.jid.replace(/\D/g, "");
    const profilePicUrl = await GetProfilePicUrl(number, companyId);
    const contactData = {
      name: `${number}`,
      number,
      profilePicUrl,
      isGroup: false,
      companyId
    };

    const contact = await CreateOrUpdateContactService(contactData);

    const ticket = await FindOrCreateTicketService(
      contact,
      whatsapp.id!,
      0,
      companyId,
      undefined,
      "api"
    );

    if (medias && medias.length > 0) {
      // Midia do endpoint legado tambem vai pelo outbox (Task 4): upload
      // duravel antes de enfileirar, sem desvio pela fila Bull.
      await Promise.all(
        medias.map(async (media: Express.Multer.File) => {
          const localPath = await persistMessagingUpload(media);
          await outboundMessageService.create({
            companyId,
            ticketId: ticket.id,
            idempotencyScope: "legacy-api-media",
            idempotencyKey: uuidv4(),
            kind: messageKindForMime(media.mimetype),
            payload: {
              localPath,
              caption: body ? formatBody(body, contact) : media.originalname,
              fileName: media.originalname,
              mimeType: media.mimetype
            },
            origin: "api"
          });
        })
      );
    } else {
      // Gate de prontidao preservado (45s -> 503): o contrato legado falha
      // quando a sessao esta fora; a entrega em si vai pelo outbox.
      try {
        await GetTicketWbot(ticket, { waitForReconnectMs: 45000 });
      } catch {
        throw new AppError("ERR_WAPP_NOT_AVAILABLE", 503);
      }
      await outboundMessageService.create({
        companyId,
        ticketId: ticket.id,
        idempotencyScope: "legacy-api",
        idempotencyKey: uuidv4(),
        kind: "text",
        text: formatBody(body, contact),
        origin: "api"
      });
    }

    if (messageData.closeTicket) {
      setTimeout(async () => {
        await UpdateTicketService({
          ticketId: ticket.id,
          ticketData: { status: "closed" },
          companyId
        });
      }, 1000);
    }

    SetTicketMessagesAsRead(ticket);

    return res.send({ mensagem: "Mensagem enviada" });
  } catch (err: any) {
    if (Object.keys(err).length === 0) {
      throw new AppError(
        "Não foi possível enviar a mensagem, tente novamente em alguns instantes"
      );
    } else {
      throw new AppError(err.message);
    }
  }
};

export const sendMessageFlow = async (
  whatsappId: number,
  body: any,
  req: Request,
  files?: Express.Multer.File[]
): Promise<string> => {
  const messageData = body;
  const medias = files;

  try {
    const whatsapp = await Whatsapp.findByPk(whatsappId);

    if (!whatsapp) {
      throw new Error("Não foi possível realizar a operação");
    }

    if (messageData.number === undefined) {
      throw new Error("O número é obrigatório");
    }

    const numberToTest = messageData.number;
    const { body: messageBody } = messageData;

    const { companyId } = messageData;

    await CheckContactNumber(numberToTest, companyId);
    const number = numberToTest.replace(/\D/g, "");

    // Helper exportado de fluxos: aceita no nucleo do outbox (Task 4)
    // em vez de desviar pela fila Bull (entrega direta no socket).
    if (medias && medias.length > 0) {
      await Promise.all(
        medias.map(async (media: Express.Multer.File) => {
          const localPath = await persistMessagingUpload(media);
          await outboundMessageService.create({
            companyId,
            whatsappId,
            recipient: number,
            idempotencyScope: "flow-api-media",
            idempotencyKey: uuidv4(),
            kind: messageKindForMime(media.mimetype),
            payload: {
              localPath,
              caption: media.originalname,
              fileName: media.originalname,
              mimeType: media.mimetype
            },
            origin: "automation"
          });
        })
      );
    } else {
      await outboundMessageService.create({
        companyId,
        whatsappId,
        recipient: number,
        idempotencyScope: "flow-api",
        idempotencyKey: uuidv4(),
        kind: "text",
        // Paridade com o antigo consumidor da fila (helpers/SendMessage).
        text: `‎ ${messageBody}`,
        origin: "automation"
      });
    }

    return "Mensagem enviada";
  } catch (err: any) {
    if (Object.keys(err).length === 0) {
      throw new AppError(
        "Não foi possível enviar a mensagem, tente novamente em alguns instantes"
      );
    } else {
      throw new AppError(err.message);
    }
  }
};
