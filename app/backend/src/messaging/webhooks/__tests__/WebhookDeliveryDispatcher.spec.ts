import WebhookDeliveryDispatcher, { nextSubscriptionFailureState } from "../WebhookDeliveryDispatcher";

const delivery = {
  id: "del_1",
  subscriptionId: "sub_1",
  urlSnapshot: "https://hooks.example.com/diachat",
  secretCiphertextSnapshot: "ciphertext",
  payload: { id: "evt_1", type: "message.received", data: {} },
  attemptCount: 1
};

describe("WebhookDeliveryDispatcher", () => {
  it("posts an exactly signed immutable JSON envelope and completes on 2xx", async () => {
    const post = jest.fn().mockResolvedValue({ status: 204, body: "" });
    const complete = jest.fn();
    const dispatcher = new WebhookDeliveryDispatcher({
      claimNext: jest.fn().mockResolvedValue(delivery),
      decryptSecret: jest.fn().mockReturnValue("signing-secret"),
      getKeyring: jest.fn().mockReturnValue({ activeKeyId: "v1", keys: { v1: "unused" } }),
      post,
      complete,
      retry: jest.fn(),
      deadLetter: jest.fn(),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
      now: jest.fn().mockReturnValue(new Date("2026-07-24T12:00:00.000Z")),
      jitter: jest.fn().mockReturnValue(0)
    });

    await expect(dispatcher.dispatchOne()).resolves.toEqual({ status: "delivered" });
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      url: delivery.urlSnapshot,
      rawBody: JSON.stringify(delivery.payload),
      headers: expect.objectContaining({
        "X-DiaChat-Timestamp": "1784894400",
        "X-DiaChat-Signature": expect.stringMatching(/^sha256=/),
        "X-DiaChat-Delivery": "del_1",
        "X-DiaChat-Event": "evt_1"
      })
    }));
    expect(complete).toHaveBeenCalled();
  });

  it("requeues retryable failures with bounded backoff", async () => {
    const retry = jest.fn();
    const dispatcher = new WebhookDeliveryDispatcher({
      claimNext: jest.fn().mockResolvedValue(delivery), decryptSecret: jest.fn().mockReturnValue("secret"),
      getKeyring: jest.fn().mockReturnValue({ activeKeyId: "v1", keys: {} }),
      post: jest.fn().mockResolvedValue({ status: 503, body: "unavailable" }), complete: jest.fn(), retry,
      deadLetter: jest.fn(), recordSuccess: jest.fn(), recordFailure: jest.fn(),
      now: jest.fn().mockReturnValue(new Date("2026-07-24T12:00:00.000Z")), jitter: jest.fn().mockReturnValue(0)
    });
    await expect(dispatcher.dispatchOne()).resolves.toEqual({ status: "retry" });
    expect(retry).toHaveBeenCalledWith("del_1", expect.any(Date), 503, "unavailable");
  });

  it("dead-letters the sixth failure", async () => {
    const deadLetter = jest.fn();
    const dispatcher = new WebhookDeliveryDispatcher({
      claimNext: jest.fn().mockResolvedValue({ ...delivery, attemptCount: 6 }), decryptSecret: jest.fn().mockReturnValue("secret"),
      getKeyring: jest.fn().mockReturnValue({ activeKeyId: "v1", keys: {} }),
      post: jest.fn().mockRejectedValue(new Error("timeout")), complete: jest.fn(), retry: jest.fn(),
      deadLetter, recordSuccess: jest.fn(), recordFailure: jest.fn(),
      now: jest.fn().mockReturnValue(new Date()), jitter: jest.fn().mockReturnValue(0)
    });
    await expect(dispatcher.dispatchOne()).resolves.toEqual({ status: "dead_letter" });
    expect(deadLetter).toHaveBeenCalledWith("del_1", undefined, "timeout");
  });

  it("pauses a subscription on its fiftieth consecutive terminal failure", () => {
    const now = new Date("2026-07-24T12:00:00.000Z");
    expect(nextSubscriptionFailureState(49, now)).toEqual({
      consecutiveFailures: 50,
      lastFailureAt: now,
      pausedAt: now
    });
  });
});
