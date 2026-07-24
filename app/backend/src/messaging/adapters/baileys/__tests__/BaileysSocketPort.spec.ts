import { sendBaileysSocketMessage } from "../BaileysSocketPort";

describe("BaileysSocketPort", () => {
  it("is the single low-level send boundary for legacy flows", async () => {
    const sendMessage = jest.fn().mockResolvedValue({ key: { id: "wa_1" } });
    await expect(sendBaileysSocketMessage(
      { sendMessage } as any,
      "5511999999999@s.whatsapp.net",
      { text: "Oi" }
    )).resolves.toEqual({ key: { id: "wa_1" } });
    expect(sendMessage).toHaveBeenCalledWith(
      "5511999999999@s.whatsapp.net",
      { text: "Oi" },
      undefined
    );
  });
});
