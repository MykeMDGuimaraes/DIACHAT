jest.mock("../../../helpers/GetTicketWbot", () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue({ sendMessage: jest.fn() })
}));

import SendWhatsAppMessage from "../SendWhatsAppMessage";
import GetTicketWbot from "../../../helpers/GetTicketWbot";

describe("SendWhatsAppMessage", () => {
  it("delivers ticket text through the public ticket messaging facade", async () => {
    const ticket = {
      isGroup: false,
      contact: { number: "5511999999999" },
      update: jest.fn()
    } as any;
    const sentMessage = { key: { id: "wa_1" } };
    const sendMessage = jest.fn().mockResolvedValue(sentMessage);
    (GetTicketWbot as jest.Mock).mockResolvedValue({ sendMessage });

    await expect(SendWhatsAppMessage({ body: "Olá", ticket })).resolves.toBe(
      sentMessage
    );

    expect(sendMessage).toHaveBeenCalledWith(
      "5511999999999@s.whatsapp.net",
      { text: "Olá" },
      undefined
    );
    expect(ticket.update).toHaveBeenCalledWith({ lastMessage: "Olá" });
  });
});
