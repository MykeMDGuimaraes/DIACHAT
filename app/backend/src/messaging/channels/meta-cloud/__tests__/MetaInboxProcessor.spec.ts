import { Op } from "sequelize";
import sequelize from "../../../../database";
import MessagingInboxEvent from "../../../persistence/models/MessagingInboxEvent";
import MessagingOutboxEvent from "../../../persistence/models/MessagingOutboxEvent";
import MetaInboxProcessor from "../MetaInboxProcessor";

describe("MetaInboxProcessor", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("persists normalized messages and statuses before completing the inbox item", async () => {
    const persistMessage = jest.fn();
    const persistStatus = jest.fn();
    const complete = jest.fn();
    const resolveMedia = jest.fn().mockResolvedValue(undefined);
    const processor = new MetaInboxProcessor({
      claimNext: jest.fn().mockResolvedValue({
        id: "inbox_1",
        companyId: 7,
        whatsappId: 42,
        attemptCount: 1,
        payload: {
          entry: [
            {
              changes: [
                {
                  value: {
                    messages: [
                      {
                        id: "wamid.in",
                        from: "5511999999999",
                        type: "text",
                        text: { body: "Oi" }
                      }
                    ],
                    statuses: [{ id: "wamid.out", status: "read" }]
                  }
                }
              ]
            }
          ]
        }
      }),
      persistMessage,
      persistStatus,
      resolveMedia,
      complete,
      release: jest.fn()
    });

    await expect(processor.processOne()).resolves.toEqual({
      status: "processed"
    });
    expect(persistMessage).toHaveBeenCalledWith(
      7,
      42,
      expect.objectContaining({ providerMessageId: "wamid.in" })
    );
    expect(persistStatus).toHaveBeenCalledWith(
      7,
      42,
      expect.objectContaining({ providerMessageId: "wamid.out", ack: 4 })
    );
    expect(complete).toHaveBeenCalledWith("inbox_1");
  });

  it("releases a failed inbox item with backoff before the eighth attempt", async () => {
    const release = jest.fn();
    const processor = new MetaInboxProcessor({
      claimNext: jest.fn().mockResolvedValue({
        id: "inbox_1",
        companyId: 7,
        whatsappId: 42,
        attemptCount: 3,
        payload: { entry: [] }
      }),
      persistMessage: jest.fn().mockRejectedValue(new Error("temporary")),
      persistStatus: jest.fn(),
      resolveMedia: jest.fn(),
      complete: jest.fn(),
      release
    });
    jest.spyOn(processor, "parse").mockReturnValue({
      messages: [{ providerMessageId: "x" } as any],
      statuses: []
    });

    await expect(processor.processOne()).resolves.toEqual({ status: "retry" });
    expect(release).toHaveBeenCalledWith(
      "inbox_1",
      "temporary",
      expect.any(Date),
      false
    );
    expect(release.mock.calls[0][2].getTime()).toBeGreaterThan(Date.now());
  });

  it("dead-letters a persistently failing inbox item on the eighth attempt", async () => {
    const release = jest.fn();
    const processor = new MetaInboxProcessor({
      claimNext: jest.fn().mockResolvedValue({
        id: "inbox_8",
        companyId: 7,
        whatsappId: 42,
        attemptCount: 8,
        payload: { entry: [] }
      }),
      persistMessage: jest.fn().mockRejectedValue(new Error("permanent")),
      persistStatus: jest.fn(),
      resolveMedia: jest.fn(),
      complete: jest.fn(),
      release
    });
    jest.spyOn(processor, "parse").mockReturnValue({
      messages: [{ providerMessageId: "x" } as any],
      statuses: []
    });

    await expect(processor.processOne()).resolves.toEqual({
      status: "dead_letter"
    });
    expect(release).toHaveBeenCalledWith(
      "inbox_8",
      "permanent",
      expect.any(Date),
      true
    );
  });

  it("claims only due Meta inbox events", async () => {
    const transaction = { LOCK: { UPDATE: "UPDATE" } };
    jest
      .spyOn(sequelize, "transaction")
      .mockImplementation((async callback =>
        callback(transaction)) as typeof sequelize.transaction);
    const findOne = jest
      .spyOn(MessagingInboxEvent, "findOne")
      .mockResolvedValue(null);

    await expect(new MetaInboxProcessor().processOne()).resolves.toEqual({
      status: "idle"
    });

    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider: "meta_cloud",
          status: "received",
          availableAt: { [Op.lte]: expect.any(Date) }
        }
      })
    );
  });

  it("dead-letters the inbox and companion callback outbox in one transaction", async () => {
    const transaction = { LOCK: { UPDATE: "UPDATE" } };
    const inbox = {
      attemptCount: 7,
      update: jest.fn().mockResolvedValue(undefined),
      toJSON: jest.fn().mockReturnValue({
        id: "inbox_8",
        companyId: 7,
        whatsappId: 42,
        attemptCount: 8,
        payload: {}
      })
    };
    jest
      .spyOn(sequelize, "transaction")
      .mockImplementation((async callback =>
        callback(transaction)) as typeof sequelize.transaction);
    jest.spyOn(MessagingInboxEvent, "findOne").mockResolvedValue(inbox as any);
    const updateInbox = jest
      .spyOn(MessagingInboxEvent, "update")
      .mockResolvedValue([1]);
    const updateOutbox = jest
      .spyOn(MessagingOutboxEvent, "update")
      .mockResolvedValue([1]);
    const processor = new MetaInboxProcessor();
    jest.spyOn(processor, "parse").mockImplementation(() => {
      throw new Error("callback inválido");
    });

    await expect(processor.processOne()).resolves.toEqual({
      status: "dead_letter"
    });
    expect(updateInbox).toHaveBeenCalledWith(
      expect.objectContaining({ status: "dead_letter" }),
      expect.objectContaining({ transaction })
    );
    expect(updateOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "dead_letter",
        lastError: "callback inválido"
      }),
      expect.objectContaining({
        where: expect.objectContaining({
          eventType: "meta.callback.received",
          aggregateId: "inbox_8",
          status: "ready"
        }),
        transaction
      })
    );
  });
});
