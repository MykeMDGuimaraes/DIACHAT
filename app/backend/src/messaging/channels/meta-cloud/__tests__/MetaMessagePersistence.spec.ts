import { NormalizedMetaMessage } from "../MetaCallbackParser";
import { persistMetaMessage } from "../MetaInboxProcessor";

const incoming: NormalizedMetaMessage = {
  providerMessageId: "wamid.inbound",
  sender: "5511999999999",
  senderName: "Cliente",
  kind: "text",
  body: "Olá",
  raw: {
    id: "wamid.inbound",
    from: "5511999999999",
    type: "text",
    text: { body: "Olá" }
  }
};

describe("persistMetaMessage", () => {
  it("persists the complete message before emitting the shared realtime notification", async () => {
    const events: string[] = [];
    const contact = { id: 3 };
    const ticket = {
      id: 9,
      unreadMessages: 1,
      update: jest.fn().mockResolvedValue(undefined)
    };
    const hydratedMessage = { id: incoming.providerMessageId, ticket };
    const findMessage = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(hydratedMessage)
      .mockResolvedValueOnce(hydratedMessage)
      .mockResolvedValueOnce(hydratedMessage);
    const createMessage = jest.fn().mockResolvedValue(hydratedMessage);
    const createOutbox = jest.fn().mockResolvedValue(undefined);
    const notifyMessage = jest
      .fn()
      .mockImplementationOnce(() => {
        events.push("notify");
        throw new Error("socket indisponível");
      })
      .mockImplementationOnce(() => {
        events.push("notify");
      });
    const dependencies = {
      transaction: async <T>(
        callback: (transaction: { id: string }) => Promise<T>
      ): Promise<T> => {
        events.push("transaction");
        const result = await callback({ id: "tx" });
        events.push("commit");
        return result;
      },
      findMessage,
      findContact: jest.fn().mockResolvedValue(contact),
      createContact: jest.fn(),
      findTicket: jest.fn().mockResolvedValue(ticket),
      createTicket: jest.fn(),
      createMessage,
      createOutbox,
      loadMessage: jest.fn().mockResolvedValue(hydratedMessage),
      notifyMessage
    };

    await expect(
      persistMetaMessage(7, 42, incoming, dependencies)
    ).rejects.toThrow("socket indisponível");
    expect(events.slice(0, 3)).toEqual(["transaction", "commit", "notify"]);
    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "wamid.inbound",
        companyId: 7,
        remoteJid: "5511999999999@s.whatsapp.net",
        dataJson: JSON.stringify(incoming.raw)
      }),
      { id: "tx" }
    );

    await expect(
      persistMetaMessage(7, 42, incoming, dependencies)
    ).resolves.toBeUndefined();
    expect(createMessage).toHaveBeenCalledTimes(1);
    expect(createOutbox).toHaveBeenCalledTimes(1);
    expect(notifyMessage).toHaveBeenCalledTimes(2);
    expect(events).toEqual([
      "transaction",
      "commit",
      "notify",
      "transaction",
      "commit",
      "notify"
    ]);
  });
});
