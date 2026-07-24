import MessagingOutboxRecoveryService from "../MessagingOutboxRecoveryService";

describe("MessagingOutboxRecoveryService", () => {
  it("completes an expired outbox event whose send result is unknown", async () => {
    const complete = jest.fn();
    const resetReady = jest.fn();
    const service = new MessagingOutboxRecoveryService({
      findExpiredProcessingEvents: jest.fn().mockResolvedValue([
        { id: "outbox_1", aggregateId: "cmd_1" }
      ]),
      findCommandStatus: jest.fn().mockResolvedValue("unknown"),
      complete,
      resetReady
    });

    await expect(service.recover(new Date())).resolves.toEqual({ completed: 1, requeued: 0 });
    expect(complete).toHaveBeenCalledWith("outbox_1");
    expect(resetReady).not.toHaveBeenCalled();
  });

  it("requeues an expired event only when no provider send was in progress", async () => {
    const complete = jest.fn();
    const resetReady = jest.fn();
    const service = new MessagingOutboxRecoveryService({
      findExpiredProcessingEvents: jest.fn().mockResolvedValue([
        { id: "outbox_1", aggregateId: "cmd_1" }
      ]),
      findCommandStatus: jest.fn().mockResolvedValue("queued"),
      complete,
      resetReady
    });

    await expect(service.recover(new Date())).resolves.toEqual({ completed: 0, requeued: 1 });
    expect(resetReady).toHaveBeenCalledWith("outbox_1");
    expect(complete).not.toHaveBeenCalled();
  });
});
