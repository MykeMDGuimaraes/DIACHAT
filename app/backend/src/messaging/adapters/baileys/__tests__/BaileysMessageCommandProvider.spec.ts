import BaileysMessageCommandProvider from "../BaileysMessageCommandProvider";

// Anti-SSRF: midia remota passa pelo fetcher controlado e chega ao adapter
// apenas como arquivo staged local — nunca como URL.
jest.mock("../../../application/fetchRemoteMediaSecurely", () => ({
  fetchRemoteMediaSecurely: jest
    .fn()
    .mockResolvedValue("messaging/staged-photo.jpg")
}));

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
        requestPayload: { ticketId: 17, text: "Olá" }
      })
    ).resolves.toEqual({ providerMessageId: "wamid_1" });

    expect(sendText).toHaveBeenCalledWith({
      ticket,
      text: "Olá",
      messageId: "cmd_1"
    });
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
    ).rejects.toMatchObject({
      classification: "permanent",
      code: "BAILEYS_INVALID_PAYLOAD"
    });
  });

  it("sends supported media through the adapter without bypassing the port", async () => {
    const ticket = { id: 17, contact: { number: "5511999999999" } };
    const sendContent = jest
      .fn()
      .mockResolvedValue({ key: { id: "wamid_media" } });
    const provider = new BaileysMessageCommandProvider({
      findTicket: jest.fn().mockResolvedValue(ticket),
      sendText: jest.fn(),
      sendContent
    });

    await expect(
      provider.send({
        id: "cmd_media",
        companyId: 10,
        whatsappId: 2,
        provider: "baileys",
        messageKind: "image",
        recipient: "5511999999999",
        requestPayload: {
          ticketId: 17,
          link: "https://cdn.example.com/photo.jpg",
          caption: "Foto"
        }
      })
    ).resolves.toEqual({ providerMessageId: "wamid_media" });

    expect(sendContent).toHaveBeenCalledWith({
      ticket,
      content: {
        image: {
          url: expect.stringMatching(
            /storage[\\/]messaging[\\/]staged-photo\.jpg$/
          )
        },
        caption: "Foto"
      },
      messageId: "cmd_media"
    });
  });

  it("sends native quick-reply buttons without a text fallback", async () => {
    const ticket = { id: 17, contact: { number: "5511999999999" } };
    const sendNativeButtons = jest
      .fn()
      .mockResolvedValue({ key: { id: "wamid_buttons" } });
    const provider = new BaileysMessageCommandProvider({
      findTicket: jest.fn().mockResolvedValue(ticket),
      sendText: jest.fn(),
      sendNativeButtons
    });

    await expect(
      provider.send({
        id: "cmd_buttons",
        companyId: 10,
        whatsappId: 2,
        provider: "baileys",
        messageKind: "buttons",
        recipient: "5511999999999",
        requestPayload: {
          ticketId: 17,
          text: "Escolha",
          buttons: [
            { id: "accept:ticket_1", title: "Aceitar" },
            { id: "reject:ticket_1", title: "Recusar" }
          ]
        }
      })
    ).resolves.toEqual({ providerMessageId: "wamid_buttons" });

    expect(sendNativeButtons).toHaveBeenCalledWith({
      ticket,
      text: "Escolha",
      buttons: [
        { id: "accept:ticket_1", title: "Aceitar" },
        { id: "reject:ticket_1", title: "Recusar" }
      ],
      messageId: "cmd_buttons"
    });
  });

  it("sintetiza o quoted de uma Message upfront e repassa ao adapter", async () => {
    const ticket = { id: 17, contact: { number: "5511999999999" } };
    const sendText = jest.fn().mockResolvedValue({ key: { id: "cmd_q" } });
    const findQuotedMessage = jest.fn().mockResolvedValue({
      id: "upfront-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      fromMe: true,
      body: "mensagem upfront",
      dataJson: JSON.stringify({
        kind: "text",
        text: "mensagem upfront",
        origin: "screen"
      })
    });
    const provider = new BaileysMessageCommandProvider({
      findTicket: jest.fn().mockResolvedValue(ticket),
      findQuotedMessage,
      sendText
    });

    await provider.send({
      id: "cmd_q",
      companyId: 10,
      whatsappId: 2,
      provider: "baileys",
      messageKind: "text",
      recipient: "5511999999999",
      requestPayload: {
        ticketId: 17,
        text: "resposta",
        quotedMessageId: "upfront-1"
      }
    });

    expect(findQuotedMessage).toHaveBeenCalledWith("upfront-1", 17, 10);
    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        quoted: {
          key: {
            id: "upfront-1",
            remoteJid: "5511999999999@s.whatsapp.net",
            fromMe: true
          },
          message: { extendedTextMessage: { text: "mensagem upfront" } }
        }
      })
    );
  });

  it("timeout apos sendMessage e classificado como unknown (nunca reenvio automatico)", async () => {
    jest.useFakeTimers();
    try {
      const ticket = { id: 17, contact: { number: "5511999999999" } };
      const sendText = jest.fn().mockReturnValue(new Promise(() => {}));
      const provider = new BaileysMessageCommandProvider({
        findTicket: jest.fn().mockResolvedValue(ticket),
        sendText
      });

      const pending = provider.send({
        id: "cmd_timeout",
        companyId: 10,
        whatsappId: 2,
        provider: "baileys",
        messageKind: "text",
        recipient: "5511999999999",
        requestPayload: { ticketId: 17, text: "ola" }
      });
      const assertion = expect(pending).rejects.toMatchObject({
        classification: "unknown",
        code: "BAILEYS_SEND_TIMEOUT"
      });
      // Deixa a cadeia de microtasks chegar ate o setTimeout do
      // withSendTimeout antes de avancar o relogio (jest 27).
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(60_000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it("encaminha ptt e mimetype de voice note no conteudo de audio", async () => {
    const ticket = { id: 17, contact: { number: "5511999999999" } };
    const sendContent = jest
      .fn()
      .mockResolvedValue({ key: { id: "wamid_ptt" } });
    const provider = new BaileysMessageCommandProvider({
      findTicket: jest.fn().mockResolvedValue(ticket),
      sendText: jest.fn(),
      sendContent
    });

    await provider.send({
      id: "cmd_ptt",
      companyId: 10,
      whatsappId: 2,
      provider: "baileys",
      messageKind: "audio",
      recipient: "5511999999999",
      requestPayload: {
        ticketId: 17,
        localPath: "messaging/voz.m4a",
        mimeType: "audio/mp4",
        ptt: true
      }
    });

    expect(sendContent).toHaveBeenCalledWith({
      ticket,
      content: {
        audio: { url: expect.stringContaining("voz.m4a") },
        mimetype: "audio/mp4",
        ptt: true
      },
      messageId: "cmd_ptt"
    });
  });
});
