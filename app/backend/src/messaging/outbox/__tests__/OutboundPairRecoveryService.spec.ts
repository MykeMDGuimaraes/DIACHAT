import sequelize from "../../../database";
import {
  MESSAGE_COMMAND_STATUS,
  OUTBOX_EVENT_STATUS
} from "../../domain/MessagingStates";
import MessageCommand from "../../persistence/models/MessageCommand";
import MessagingOutboxEvent from "../../persistence/models/MessagingOutboxEvent";
import OutboundPairRecoveryService from "../OutboundPairRecoveryService";

describe("OutboundPairRecoveryService locking contract", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("waits for command and event row locks instead of skipping a locked pair", async () => {
    const command = {
      id: "cmd_1",
      status: MESSAGE_COMMAND_STATUS.QUEUED,
      leaseExpiresAt: null
    };
    const event = {
      id: "evt_1",
      status: OUTBOX_EVENT_STATUS.PROCESSING,
      update: jest.fn().mockResolvedValue(undefined)
    };

    jest
      .spyOn(sequelize, "transaction")
      .mockImplementation((async (callback: (transaction: any) => unknown) =>
        callback({ LOCK: { UPDATE: "UPDATE" } })) as any);
    jest
      .spyOn(MessagingOutboxEvent, "findAll")
      .mockResolvedValue([
        { id: event.id, aggregateId: command.id }
      ] as MessagingOutboxEvent[]);
    jest.spyOn(MessageCommand, "findAll").mockResolvedValue([]);
    const findCommand = jest
      .spyOn(MessageCommand, "findOne")
      .mockResolvedValue(command as MessageCommand);
    const findEvent = jest
      .spyOn(MessagingOutboxEvent, "findOne")
      .mockResolvedValue(event as unknown as MessagingOutboxEvent);

    await expect(
      new OutboundPairRecoveryService().recover(new Date())
    ).resolves.toEqual({ recovered: 1 });

    expect(findCommand.mock.calls[0][0]).not.toHaveProperty("skipLocked", true);
    expect(findEvent.mock.calls[0][0]).not.toHaveProperty("skipLocked", true);
    expect(event.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: OUTBOX_EVENT_STATUS.READY }),
      expect.any(Object)
    );
  });
});
