import MessageCommandDispatcher, { buildMessageSentEvent } from "../MessageCommandDispatcher";

describe("MessageCommandDispatcher", () => {
  const claimed = {
    eventId: "outbox_1",
    command: {
      id: "cmd_1",
      provider: "baileys",
      requestPayload: { text: "OlÃ¡" }
    }
  };

  it("delivers a claimed command and marks the outbox event completed", async () => {
    const markSent = jest.fn();
    const dispatcher = new MessageCommandDispatcher({
      claimNext: jest.fn().mockResolvedValue(claimed),
      send: jest.fn().mockResolvedValue({ providerMessageId: "wamid_1" }),
      markSent,
      markUnknown: jest.fn()
    });

    await expect(dispatcher.dispatchOne()).resolves.toEqual({ status: "sent" });

    expect(markSent).toHaveBeenCalledWith("cmd_1", "outbox_1", "wamid_1");
  });

  it("never requeues a command after a provider error with unknown outcome", async () => {
    const markUnknown = jest.fn();
    const dispatcher = new MessageCommandDispatcher({
      claimNext: jest.fn().mockResolvedValue(claimed),
      send: jest.fn().mockRejectedValue(new Error("socket timeout")),
      markSent: jest.fn(),
      markUnknown
    });

    await expect(dispatcher.dispatchOne()).resolves.toEqual({ status: "unknown" });

    expect(markUnknown).toHaveBeenCalledWith(
      "cmd_1",
      "outbox_1",
      "socket timeout"
    );
  });

  it("does nothing when no outbox event is ready", async () => {
    const dispatcher = new MessageCommandDispatcher({
      claimNext: jest.fn().mockResolvedValue(null),
      send: jest.fn(),
      markSent: jest.fn(),
      markUnknown: jest.fn()
    });

    await expect(dispatcher.dispatchOne()).resolves.toEqual({ status: "idle" });
  });

  it("builds the durable customer webhook event after provider acknowledgement", () => {
    expect(buildMessageSentEvent({
      id: "cmd_1",
      companyId: 7,
      whatsappId: 42,
      messageId: "msg_1",
      messageKind: "image"
    }, "wamid.1")).toEqual(expect.objectContaining({
      eventType: "message.sent",
      aggregateId: "msg_1",
      payload: expect.objectContaining({
        providerMessageId: "wamid.1",
        kind: "image",
        origin: "api"
      })
    }));
  });
});
