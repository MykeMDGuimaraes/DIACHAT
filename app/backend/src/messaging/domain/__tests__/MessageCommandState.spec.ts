import {
  recoverExpiredSendingCommand,
  type MessageCommandState
} from "../MessageCommandState";

describe("MessageCommandState", () => {
  it("marks an abandoned provider send as unknown instead of requeueing it", () => {
    const command: MessageCommandState = {
      id: "cmd_1",
      status: "sending",
      leaseExpiresAt: new Date("2026-07-24T12:00:00.000Z")
    };

    const recovered = recoverExpiredSendingCommand(
      command,
      new Date("2026-07-24T12:00:01.000Z")
    );

    expect(recovered).toEqual({
      ...command,
      status: "unknown",
      errorCode: "SEND_OUTCOME_UNKNOWN",
      leaseExpiresAt: undefined
    });
  });

  it("does not alter a sending command with an active lease", () => {
    const command: MessageCommandState = {
      id: "cmd_2",
      status: "sending",
      leaseExpiresAt: new Date("2026-07-24T12:00:01.000Z")
    };

    expect(
      recoverExpiredSendingCommand(command, new Date("2026-07-24T12:00:00.000Z"))
    ).toBe(command);
  });
});
