import { execFileSync } from "child_process";
import BaileysTicketMessagingProvider from "../BaileysTicketMessagingProvider";

describe("BaileysTicketMessagingProvider", () => {
  it("sends a ticket text to the individual WhatsApp jid", async () => {
    const sendMessage = jest.fn().mockResolvedValue({ key: { id: "wa_1" } });
    const provider = new BaileysTicketMessagingProvider(async () => ({
      sendMessage
    }));

    await provider.sendText({
      ticket: {
        isGroup: false,
        contact: { number: "5511999999999" }
      } as any,
      text: "Olá"
    });

    expect(sendMessage).toHaveBeenCalledWith(
      "5511999999999@s.whatsapp.net",
      { text: "Olá" },
      undefined
    );
  });

  it("serializes native quick replies through the vendored Baileys proto and relays them", async () => {
    const sendMessage = jest.fn();
    const relayMessage = jest.fn().mockResolvedValue("wa_buttons");
    const nativeButtonsRelay = jest.fn().mockResolvedValue({
      key: { id: "wa_buttons" },
      message: { viewOnceMessage: {} }
    });
    const provider = new BaileysTicketMessagingProvider(
      async () => ({
        sendMessage,
        relayMessage,
        user: { id: "5511888888888:1@s.whatsapp.net", name: "DIA CHAT" }
      }),
      nativeButtonsRelay
    );

    await provider.sendNativeButtons({
      ticket: {
        isGroup: false,
        contact: { number: "5511999999999" }
      } as any,
      text: "Escolha",
      buttons: [
        { id: "accept:ticket_1", title: "Aceitar" },
        { id: "reject_ticket-1", title: "Recusar" }
      ],
      messageId: "cmd-buttons-1"
    });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(nativeButtonsRelay).toHaveBeenCalledWith(
      expect.objectContaining({ relayMessage }),
      "5511999999999@s.whatsapp.net",
      "Escolha",
      [
        { id: "accept:ticket_1", title: "Aceitar" },
        { id: "reject_ticket-1", title: "Recusar" }
      ],
      "cmd-buttons-1",
      undefined
    );
  });

  it("round-trips the native flow payload with the installed Baileys package", () => {
    const script = `
      import baileys from "baileys";
      const { proto } = baileys;
      const value = proto.Message.fromObject({
        viewOnceMessage: { message: { interactiveMessage: {
          body: { text: "Escolha" },
          nativeFlowMessage: { buttons: [{
            name: "quick_reply",
            buttonParamsJson: JSON.stringify({
              display_text: "Aceitar",
              id: "accept:ticket_1"
            })
          }] }
        } } }
      });
      const decoded = proto.Message.decode(proto.Message.encode(value).finish());
      process.stdout.write(decoded.viewOnceMessage.message.interactiveMessage
        .nativeFlowMessage.buttons[0].buttonParamsJson);
    `;
    const serialized = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      { cwd: process.cwd(), encoding: "utf8" }
    );
    expect(JSON.parse(serialized)).toEqual({
      display_text: "Aceitar",
      id: "accept:ticket_1"
    });
  });
});
