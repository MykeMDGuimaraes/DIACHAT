import ConversationCommandRecoveryService from "../ConversationCommandRecoveryService";

describe("ConversationCommandRecoveryService", () => {
  it("requeues expired leased conversation command pairs", async () => {
    const recoverExpired = jest.fn().mockResolvedValue(2);
    const service = new ConversationCommandRecoveryService({
      recoverExpired
    });
    const now = new Date("2026-07-28T20:00:00.000Z");

    await expect(service.recover(now)).resolves.toEqual({ recovered: 2 });
    expect(recoverExpired).toHaveBeenCalledWith(now);
  });
});
