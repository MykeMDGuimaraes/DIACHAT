import { Op } from "sequelize";
import sequelize from "../../../../database";
import Message from "../../../../models/Message";
import ChannelDeliveryHealthService from "../../../application/ChannelDeliveryHealthService";
import MessageCommand from "../../../persistence/models/MessageCommand";
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
      status: "processed",
      healthChangedChannels: []
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

  it("publishes Meta chat and connection lifecycle callbacks before completing the inbox item", async () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              field: "account_update",
              value: { state: "connected", phone_number_id: "phone-number-1" }
            },
            {
              field: "messages",
              value: {
                chats: [{ jid: "5511999999999@s.whatsapp.net" }]
              }
            }
          ]
        }
      ]
    };
    const publishLifecycle = jest.fn().mockResolvedValue(undefined);
    const complete = jest.fn().mockResolvedValue(undefined);
    const processor = new MetaInboxProcessor({
      claimNext: jest.fn().mockResolvedValue({
        id: "inbox_lifecycle",
        companyId: 7,
        whatsappId: 42,
        attemptCount: 1,
        payload
      }),
      persistMessage: jest.fn(),
      persistStatus: jest.fn(),
      resolveMedia: jest.fn(),
      publishLifecycle,
      complete,
      release: jest.fn()
    });

    await expect(processor.processOne()).resolves.toEqual({
      status: "processed",
      healthChangedChannels: []
    });
    expect(publishLifecycle).toHaveBeenCalledWith(7, 42, payload);
    expect(publishLifecycle.mock.invocationCallOrder[0]).toBeLessThan(
      complete.mock.invocationCallOrder[0]
    );
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

  it("a Meta delivered confirmation heals a degraded channel and surfaces it for post-commit emit", async () => {
    const transaction = { LOCK: { UPDATE: "UPDATE" } };
    const restoredChannel = { id: 42, deliveryHealth: "healthy" };
    jest
      .spyOn(sequelize, "transaction")
      .mockImplementation((async (callback: any) =>
        callback(transaction)) as typeof sequelize.transaction);
    const command = {
      id: "command-1",
      status: "unknown",
      messageId: "msg-1",
      conversationId: "conv-1",
      contactId: 1,
      externalTicketId: null,
      automationEpoch: 1,
      update: jest.fn().mockResolvedValue(undefined)
    };
    jest.spyOn(MessageCommand, "findOne").mockResolvedValue(command as any);
    jest.spyOn(Message, "update").mockResolvedValue([1] as any);
    jest.spyOn(MessagingOutboxEvent, "create").mockResolvedValue({} as any);
    const recordConfirmed = jest
      .spyOn(ChannelDeliveryHealthService.prototype, "recordConfirmedDelivery")
      .mockResolvedValue(restoredChannel as any);
    const processor = new MetaInboxProcessor({
      claimNext: jest.fn().mockResolvedValue({
        id: "inbox-1",
        companyId: 7,
        whatsappId: 42,
        attemptCount: 0,
        payload: {
          entry: [
            {
              changes: [
                {
                  value: {
                    statuses: [
                      {
                        id: "wamid.out",
                        status: "delivered",
                        timestamp: "1785000000"
                      }
                    ]
                  }
                }
              ]
            }
          ]
        }
      }),
      complete: jest.fn().mockResolvedValue(undefined),
      publishLifecycle: jest.fn().mockResolvedValue(undefined)
    });

    const result = await processor.processOne();

    expect(recordConfirmed).toHaveBeenCalledWith(42, transaction);
    expect(command.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "delivered" }),
      expect.objectContaining({ transaction })
    );
    expect(result).toEqual({
      status: "processed",
      healthChangedChannels: [restoredChannel]
    });
  });

  it("does not touch channel health when the Meta status is a no-op", async () => {
    const transaction = { LOCK: { UPDATE: "UPDATE" } };
    jest
      .spyOn(sequelize, "transaction")
      .mockImplementation((async (callback: any) =>
        callback(transaction)) as typeof sequelize.transaction);
    const command = {
      id: "command-1",
      status: "read",
      update: jest.fn().mockResolvedValue(undefined)
    };
    jest.spyOn(MessageCommand, "findOne").mockResolvedValue(command as any);
    const recordConfirmed = jest
      .spyOn(ChannelDeliveryHealthService.prototype, "recordConfirmedDelivery")
      .mockResolvedValue(null);
    const processor = new MetaInboxProcessor({
      claimNext: jest.fn().mockResolvedValue({
        id: "inbox-1",
        companyId: 7,
        whatsappId: 42,
        attemptCount: 0,
        payload: {
          entry: [
            {
              changes: [
                {
                  value: {
                    statuses: [{ id: "wamid.out", status: "delivered" }]
                  }
                }
              ]
            }
          ]
        }
      }),
      complete: jest.fn().mockResolvedValue(undefined),
      publishLifecycle: jest.fn().mockResolvedValue(undefined)
    });

    const result = await processor.processOne();

    expect(command.update).not.toHaveBeenCalled();
    expect(recordConfirmed).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "processed", healthChangedChannels: [] });
  });
});
