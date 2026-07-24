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
});
