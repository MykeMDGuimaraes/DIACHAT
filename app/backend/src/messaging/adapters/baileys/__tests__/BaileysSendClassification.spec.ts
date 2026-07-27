import BaileysMessageCommandProvider from "../BaileysMessageCommandProvider";
import BaileysTicketMessagingProvider from "../BaileysTicketMessagingProvider";

const baseCommand = {
  id: "cmd_1",
  companyId: 10,
  whatsappId: 2,
  provider: "baileys",
  messageKind: "text",
  recipient: "5511999999999",
  requestPayload: { ticketId: 17, text: "oi" }
} as any;

describe("BaileysMessageCommandProvider classification", () => {
  it("classifies unsupported kinds as permanent", async () => {
    const provider = new BaileysMessageCommandProvider({
      findTicket: jest.fn(),
      sendText: jest.fn()
    });
    await expect(
      provider.send({ ...baseCommand, messageKind: "sticker" })
    ).rejects.toMatchObject({
      classification: "permanent",
      code: "BAILEYS_UNSUPPORTED_KIND"
    });
  });

  it("classifies missing ticket as permanent", async () => {
    const provider = new BaileysMessageCommandProvider({
      findTicket: jest.fn().mockResolvedValue(null),
      sendText: jest.fn()
    });
    await expect(provider.send(baseCommand)).rejects.toMatchObject({
      classification: "permanent",
      code: "BAILEYS_TICKET_NOT_FOUND"
    });
  });

  it("classifies database failure before send as retryable", async () => {
    const provider = new BaileysMessageCommandProvider({
      findTicket: jest.fn().mockRejectedValue(new Error("db offline")),
      sendText: jest.fn()
    });
    await expect(provider.send(baseCommand)).rejects.toMatchObject({
      classification: "retryable",
      code: "BAILEYS_DB_UNAVAILABLE"
    });
  });

  it("classifies invalid media link as permanent", async () => {
    const provider = new BaileysMessageCommandProvider({
      findTicket: jest.fn().mockResolvedValue({ id: 17 }),
      sendText: jest.fn(),
      sendContent: jest.fn()
    });
    await expect(
      provider.send({
        ...baseCommand,
        messageKind: "image",
        requestPayload: { ticketId: 17, link: "http://inseguro" }
      })
    ).rejects.toMatchObject({
      classification: "permanent",
      code: "BAILEYS_INVALID_MEDIA"
    });
  });

  it("classifies rejection after invoking sendMessage as unknown", async () => {
    const provider = new BaileysMessageCommandProvider({
      findTicket: jest.fn().mockResolvedValue({ id: 17 }),
      sendText: jest.fn().mockRejectedValue(new Error("stream errored"))
    });
    await expect(provider.send(baseCommand)).rejects.toMatchObject({
      classification: "unknown",
      code: "BAILEYS_SEND_REJECTED"
    });
  });

  it("propagates retryable socket-unavailable errors from the ticket provider", async () => {
    const ticketProvider = new BaileysTicketMessagingProvider(
      jest.fn().mockRejectedValue(new Error("ERR_WAPP_NOT_INITIALIZED"))
    );
    const provider = new BaileysMessageCommandProvider({
      findTicket: jest.fn().mockResolvedValue({ id: 17 }),
      sendText: input => ticketProvider.sendText(input as any)
    });
    await expect(provider.send(baseCommand)).rejects.toMatchObject({
      classification: "retryable",
      code: "BAILEYS_SOCKET_UNAVAILABLE"
    });
  });
});
