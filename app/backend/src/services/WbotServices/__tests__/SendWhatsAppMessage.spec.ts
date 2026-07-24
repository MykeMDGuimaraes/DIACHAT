jest.mock(
  "../../../messaging/adapters/baileys/getBaileysTicketMessagingProvider",
  () => ({
    __esModule: true,
    default: { sendText: jest.fn() }
  })
);

jest.mock("../../../helpers/GetTicketWbot", () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue({ sendMessage: jest.fn() })
}));

import SendWhatsAppMessage from "../SendWhatsAppMessage";
import baileysTicketMessagingProvider from "../../../messaging/adapters/baileys/getBaileysTicketMessagingProvider";

describe("SendWhatsAppMessage", () => {
  it("delegates ticket text delivery to the messaging adapter", async () => {
    const ticket = {
      isGroup: false,
      contact: { number: "5511999999999" },
      update: jest.fn()
    } as any;
    const sentMessage = { key: { id: "wa_1" } };
    (baileysTicketMessagingProvider.sendText as jest.Mock).mockResolvedValue(
      sentMessage
    );

    await expect(
      SendWhatsAppMessage({ body: "Olá", ticket })
    ).resolves.toBe(sentMessage);

    expect(baileysTicketMessagingProvider.sendText).toHaveBeenCalledWith({
      ticket,
      text: "Olá",
      quoted: undefined
    });
  });
});
