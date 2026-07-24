import MessageCommandRecoveryService from "../MessageCommandRecoveryService";

describe("MessageCommandRecoveryService", () => {
  it("marks expired sends as unknown instead of requeueing them", async () => {
    const markUnknown = jest.fn();
    const service = new MessageCommandRecoveryService({
      findExpiredSendingCommands: jest.fn().mockResolvedValue([
        { id: "cmd_1" },
        { id: "cmd_2" }
      ]),
      markUnknown
    });
    const now = new Date("2026-07-24T12:00:00.000Z");

    await expect(service.recover(now)).resolves.toEqual({ recovered: 2 });

    expect(markUnknown).toHaveBeenNthCalledWith(1, "cmd_1", now);
    expect(markUnknown).toHaveBeenNthCalledWith(2, "cmd_2", now);
  });

  it("does not write when there are no expired sends", async () => {
    const markUnknown = jest.fn();
    const service = new MessageCommandRecoveryService({
      findExpiredSendingCommands: jest.fn().mockResolvedValue([]),
      markUnknown
    });

    await expect(service.recover(new Date())).resolves.toEqual({ recovered: 0 });
    expect(markUnknown).not.toHaveBeenCalled();
  });
});
