import sequelize from "../../../database";
import Message from "../../../models/Message";
import {
  MESSAGE_COMMAND_ERROR_CODE,
  MESSAGE_COMMAND_STATUS
} from "../../domain/MessagingStates";
import MessageCommand from "../../persistence/models/MessageCommand";
import MessagingOutboxEvent from "../../persistence/models/MessagingOutboxEvent";
import DeliveryConfirmationRecoveryService from "../DeliveryConfirmationRecoveryService";

const STALE_DATE = new Date(Date.now() - 10 * 60_000);

const buildCommand = (overrides: Record<string, unknown> = {}) => ({
  id: "cmd_1",
  companyId: 7,
  messageId: "msg_1",
  status: MESSAGE_COMMAND_STATUS.SENT,
  completedAt: STALE_DATE,
  update: jest.fn().mockResolvedValue(undefined),
  toJSON: () => ({ id: "cmd_1", companyId: 7, messageId: "msg_1" }),
  ...overrides
});

describe("DeliveryConfirmationRecoveryService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const mockTransaction = () =>
    jest
      .spyOn(sequelize, "transaction")
      .mockImplementation((async (callback: (transaction: any) => unknown) =>
        callback({ LOCK: { UPDATE: "UPDATE" } })) as any);

  it("marks a stale sent command without ack as unknown (DELIVERY_UNCONFIRMED)", async () => {
    const command = buildCommand();
    mockTransaction();
    jest
      .spyOn(MessageCommand, "findAll")
      .mockResolvedValue([{ id: command.id }] as any);
    jest.spyOn(MessageCommand, "findOne").mockResolvedValue(command as any);
    jest
      .spyOn(Message, "findOne")
      .mockResolvedValue({ id: "msg_1", ack: 0 } as any);
    const createEvent = jest
      .spyOn(MessagingOutboxEvent, "create")
      .mockResolvedValue({} as any);

    await expect(
      new DeliveryConfirmationRecoveryService().recover()
    ).resolves.toMatchObject({ recovered: 1 });

    expect(command.update).toHaveBeenCalledWith(
      {
        status: MESSAGE_COMMAND_STATUS.UNKNOWN,
        errorCode: MESSAGE_COMMAND_ERROR_CODE.DELIVERY_UNCONFIRMED
      },
      expect.any(Object)
    );
    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "message.status.updated",
        payload: expect.objectContaining({
          status: MESSAGE_COMMAND_STATUS.UNKNOWN,
          errorCode: MESSAGE_COMMAND_ERROR_CODE.DELIVERY_UNCONFIRMED
        })
      }),
      expect.any(Object)
    );
  });

  it("advances a stale sent command to delivered when ack already arrived", async () => {
    const command = buildCommand();
    mockTransaction();
    jest
      .spyOn(MessageCommand, "findAll")
      .mockResolvedValue([{ id: command.id }] as any);
    jest.spyOn(MessageCommand, "findOne").mockResolvedValue(command as any);
    jest
      .spyOn(Message, "findOne")
      .mockResolvedValue({ id: "msg_1", ack: 3 } as any);
    const createEvent = jest
      .spyOn(MessagingOutboxEvent, "create")
      .mockResolvedValue({} as any);

    await expect(
      new DeliveryConfirmationRecoveryService().recover()
    ).resolves.toMatchObject({ recovered: 1 });

    expect(command.update).toHaveBeenCalledWith(
      { status: MESSAGE_COMMAND_STATUS.DELIVERED },
      expect.any(Object)
    );
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("keeps sent when ack only reached the WhatsApp server (ack 2)", async () => {
    const command = buildCommand();
    mockTransaction();
    jest
      .spyOn(MessageCommand, "findAll")
      .mockResolvedValue([{ id: command.id }] as any);
    jest.spyOn(MessageCommand, "findOne").mockResolvedValue(command as any);
    jest
      .spyOn(Message, "findOne")
      .mockResolvedValue({ id: "msg_1", ack: 2 } as any);

    await expect(
      new DeliveryConfirmationRecoveryService().recover()
    ).resolves.toMatchObject({ recovered: 0 });

    expect(command.update).not.toHaveBeenCalled();
  });

  it("advances a stale sent command to read when ack is read-level", async () => {
    const command = buildCommand();
    mockTransaction();
    jest
      .spyOn(MessageCommand, "findAll")
      .mockResolvedValue([{ id: command.id }] as any);
    jest.spyOn(MessageCommand, "findOne").mockResolvedValue(command as any);
    jest
      .spyOn(Message, "findOne")
      .mockResolvedValue({ id: "msg_1", ack: 4 } as any);

    await expect(
      new DeliveryConfirmationRecoveryService().recover()
    ).resolves.toMatchObject({ recovered: 1 });

    expect(command.update).toHaveBeenCalledWith(
      { status: MESSAGE_COMMAND_STATUS.READ },
      expect.any(Object)
    );
  });

  it("ignores commands that left sent status before the sweep locks them", async () => {
    mockTransaction();
    jest
      .spyOn(MessageCommand, "findAll")
      .mockResolvedValue([{ id: "cmd_1" }] as any);
    jest.spyOn(MessageCommand, "findOne").mockResolvedValue(null);

    await expect(
      new DeliveryConfirmationRecoveryService().recover()
    ).resolves.toMatchObject({ recovered: 0 });
  });

  it("does not touch commands still inside the confirmation window", async () => {
    mockTransaction();
    const findAll = jest
      .spyOn(MessageCommand, "findAll")
      .mockResolvedValue([]);

    await expect(
      new DeliveryConfirmationRecoveryService().recover()
    ).resolves.toMatchObject({ recovered: 0 });

    expect(findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: MESSAGE_COMMAND_STATUS.SENT
        })
      })
    );
  });

  it("records the delivery failure on the channel health when marking unknown", async () => {
    const command = buildCommand({ whatsappId: 5 });
    mockTransaction();
    jest
      .spyOn(MessageCommand, "findAll")
      .mockResolvedValue([{ id: command.id }] as any);
    jest.spyOn(MessageCommand, "findOne").mockResolvedValue(command as any);
    jest
      .spyOn(Message, "findOne")
      .mockResolvedValue({ id: "msg_1", ack: 0 } as any);
    jest.spyOn(MessagingOutboxEvent, "create").mockResolvedValue({} as any);
    const channelHealth = {
      recordUnconfirmedDelivery: jest.fn().mockResolvedValue(null)
    };

    await new DeliveryConfirmationRecoveryService(channelHealth).recover();

    expect(channelHealth.recordUnconfirmedDelivery).toHaveBeenCalledWith(
      5,
      MESSAGE_COMMAND_ERROR_CODE.DELIVERY_UNCONFIRMED,
      expect.any(Object)
    );
  });

  it("surfaces channels whose health degraded so the core can notify after commit", async () => {
    const command = buildCommand({ whatsappId: 5 });
    mockTransaction();
    jest
      .spyOn(MessageCommand, "findAll")
      .mockResolvedValue([{ id: command.id }] as any);
    jest.spyOn(MessageCommand, "findOne").mockResolvedValue(command as any);
    jest
      .spyOn(Message, "findOne")
      .mockResolvedValue({ id: "msg_1", ack: 0 } as any);
    jest.spyOn(MessagingOutboxEvent, "create").mockResolvedValue({} as any);
    const degradedChannel = { id: 5, deliveryHealth: "degraded" };
    const channelHealth = {
      recordUnconfirmedDelivery: jest.fn().mockResolvedValue(degradedChannel)
    };

    const result = await new DeliveryConfirmationRecoveryService(
      channelHealth
    ).recover();

    expect(result.healthChangedChannels).toEqual([degradedChannel]);
  });
});
