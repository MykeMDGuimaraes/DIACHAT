import BaileysMessageCommandProvider from "../BaileysMessageCommandProvider";

describe("BaileysMessageCommandProvider", () => {
  it("loads the persisted ticket and sends the text through the Baileys adapter", async () => {
    const ticket = { id: 17, contact: { number: "5511999999999" } };
    const sendText = jest.fn().mockResolvedValue({ key: { id: "wamid_1" } });
    const provider = new BaileysMessageCommandProvider({
      findTicket: jest.fn().mockResolvedValue(ticket),
      sendText
    });

    await expect(
      provider.send({
        id: "cmd_1",
        companyId: 10,
        whatsappId: 2,
        provider: "baileys",
        messageKind: "text",
        recipient: "5511999999999",
        requestPayload: { ticketId: 17, text: "OlÃ¡" }
      })
    ).resolves.toEqual({ providerMessageId: "wamid_1" });

    expect(sendText).toHaveBeenCalledWith({ ticket, text: "OlÃ¡" });
  });

  it("rejects an invalid command payload before attempting delivery", async () => {
    const provider = new BaileysMessageCommandProvider({
      findTicket: jest.fn(),
      sendText: jest.fn()
    });

    await expect(
      provider.send({
        id: "cmd_1",
        companyId: 10,
        whatsappId: 2,
        provider: "baileys",
        messageKind: "text",
        recipient: "5511999999999",
        requestPayload: { ticketId: 17 }
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("sends supported media through the adapter without bypassing the port", async () => {
    const ticket = { id: 17, contact: { number: "5511999999999" } };
    const sendContent = jest.fn().mockResolvedValue({ key: { id: "wamid_media" } });
    const provider = new BaileysMessageCommandProvider({
      findTicket: jest.fn().mockResolvedValue(ticket),
      sendText: jest.fn(),
      sendContent
    });

    await expect(provider.send({
      id: "cmd_media",
      companyId: 10,
      whatsappId: 2,
      provider: "baileys",
      messageKind: "image",
      recipient: "5511999999999",
      requestPayload: { ticketId: 17, link: "https://cdn.example.com/photo.jpg", caption: "Foto" }
    })).resolves.toEqual({ providerMessageId: "wamid_media" });

    expect(sendContent).toHaveBeenCalledWith({
      ticket,
      content: { image: { url: "https://cdn.example.com/photo.jpg" }, caption: "Foto" }
    });
  });
});
