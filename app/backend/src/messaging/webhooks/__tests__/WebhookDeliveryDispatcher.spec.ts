import WebhookDeliveryDispatcher, {
  nextSubscriptionFailureState
} from "../WebhookDeliveryDispatcher";

const delivery = {
  id: "del_1",
  companyId: 7,
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
      getKeyring: jest
        .fn()
        .mockReturnValue({ activeKeyId: "v1", keys: { v1: "unused" } }),
      post,
      complete,
      retry: jest.fn(),
      deadLetter: jest.fn(),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
      pauseSubscription: jest.fn(),
      now: jest.fn().mockReturnValue(new Date("2026-07-24T12:00:00.000Z")),
      jitter: jest.fn().mockReturnValue(0)
    });

    await expect(dispatcher.dispatchOne()).resolves.toEqual({
      status: "delivered"
    });
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        url: delivery.urlSnapshot,
        rawBody: JSON.stringify(delivery.payload),
        headers: expect.objectContaining({
          "X-DiaChat-Timestamp": "1784894400",
          "X-DiaChat-Signature": expect.stringMatching(/^sha256=/),
          "X-DiaChat-Delivery": "del_1",
          "X-DiaChat-Event": "evt_1"
        })
      })
    );
    expect(complete).toHaveBeenCalledWith("del_1", 204);
  });

  it("requeues retryable failures with bounded backoff", async () => {
    const retry = jest.fn();
    const dispatcher = new WebhookDeliveryDispatcher({
      claimNext: jest.fn().mockResolvedValue(delivery),
      decryptSecret: jest.fn().mockReturnValue("secret"),
      getKeyring: jest.fn().mockReturnValue({ activeKeyId: "v1", keys: {} }),
      post: jest.fn().mockResolvedValue({ status: 503, body: "unavailable" }),
      complete: jest.fn(),
      retry,
      deadLetter: jest.fn(),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
      pauseSubscription: jest.fn(),
      now: jest.fn().mockReturnValue(new Date("2026-07-24T12:00:00.000Z")),
      jitter: jest.fn().mockReturnValue(0)
    });
    await expect(dispatcher.dispatchOne()).resolves.toEqual({
      status: "retry"
    });
    expect(retry).toHaveBeenCalledWith(
      "del_1",
      new Date("2026-07-24T12:00:02.000Z"),
      503,
      "HTTP_503"
    );
  });

  it("dead-letters the sixth failure", async () => {
    const deadLetter = jest.fn();
    const dispatcher = new WebhookDeliveryDispatcher({
      claimNext: jest.fn().mockResolvedValue({ ...delivery, attemptCount: 6 }),
      decryptSecret: jest.fn().mockReturnValue("secret"),
      getKeyring: jest.fn().mockReturnValue({ activeKeyId: "v1", keys: {} }),
      post: jest.fn().mockRejectedValue(new Error("timeout")),
      complete: jest.fn(),
      retry: jest.fn(),
      deadLetter,
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
      pauseSubscription: jest.fn(),
      now: jest.fn().mockReturnValue(new Date()),
      jitter: jest.fn().mockReturnValue(0)
    });
    await expect(dispatcher.dispatchOne()).resolves.toEqual({
      status: "dead_letter"
    });
    expect(deadLetter).toHaveBeenCalledWith(
      "del_1",
      undefined,
      "WEBHOOK_DELIVERY_ERROR"
    );
  });

  it("requeues a delivery when loading the signing keyring fails", async () => {
    const retry = jest.fn();
    const dispatcher = new WebhookDeliveryDispatcher({
      claimNext: jest.fn().mockResolvedValue(delivery),
      decryptSecret: jest.fn(),
      getKeyring: jest.fn(() => {
        throw new Error("keyring indisponível");
      }),
      post: jest.fn(),
      complete: jest.fn(),
      retry,
      deadLetter: jest.fn(),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
      pauseSubscription: jest.fn(),
      now: jest.fn().mockReturnValue(new Date("2026-07-24T12:00:00.000Z")),
      jitter: jest.fn().mockReturnValue(0)
    });

    await expect(dispatcher.dispatchOne()).resolves.toEqual({
      status: "retry"
    });
    expect(retry).toHaveBeenCalledWith(
      "del_1",
      expect.any(Date),
      undefined,
      "WEBHOOK_DELIVERY_ERROR"
    );
  });

  it("dead-letters the sixth failure when decrypting the signing secret fails", async () => {
    const deadLetter = jest.fn();
    const recordFailure = jest.fn();
    const dispatcher = new WebhookDeliveryDispatcher({
      claimNext: jest.fn().mockResolvedValue({ ...delivery, attemptCount: 6 }),
      decryptSecret: jest.fn(() => {
        throw new Error("segredo inválido");
      }),
      getKeyring: jest
        .fn()
        .mockReturnValue({ activeKeyId: "v1", keys: { v1: "unused" } }),
      post: jest.fn(),
      complete: jest.fn(),
      retry: jest.fn(),
      deadLetter,
      recordSuccess: jest.fn(),
      recordFailure,
      pauseSubscription: jest.fn(),
      now: jest.fn().mockReturnValue(new Date("2026-07-24T12:00:00.000Z")),
      jitter: jest.fn().mockReturnValue(0)
    });

    await expect(dispatcher.dispatchOne()).resolves.toEqual({
      status: "dead_letter"
    });
    expect(deadLetter).toHaveBeenCalledWith(
      "del_1",
      undefined,
      "WEBHOOK_DELIVERY_ERROR"
    );
    expect(recordFailure).toHaveBeenCalledWith("sub_1");
  });

  it("pauses a subscription on its fiftieth consecutive terminal failure", () => {
    const now = new Date("2026-07-24T12:00:00.000Z");
    expect(nextSubscriptionFailureState(49, now)).toEqual({
      consecutiveFailures: 50,
      lastFailureAt: now,
      pausedAt: now
    });
  });

  it("hydrates contact text only in memory before signing and posting", async () => {
    const post = jest.fn().mockResolvedValue({ status: 202, body: "" });
    const hydratePayload = jest.fn().mockResolvedValue({
      ...delivery.payload,
      data: { ...delivery.payload.data, text: "resposta NPS" }
    });
    const dispatcher = new WebhookDeliveryDispatcher({
      claimNext: jest.fn().mockResolvedValue(delivery),
      decryptSecret: jest.fn().mockReturnValue("signing-secret"),
      getKeyring: jest.fn().mockReturnValue({ activeKeyId: "v1", keys: {} }),
      hydratePayload,
      post,
      complete: jest.fn(),
      retry: jest.fn(),
      deadLetter: jest.fn(),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
      pauseSubscription: jest.fn(),
      now: jest.fn().mockReturnValue(new Date("2026-07-24T12:00:00.000Z")),
      jitter: jest.fn().mockReturnValue(0)
    });

    await dispatcher.dispatchOne();

    expect(hydratePayload).toHaveBeenCalledWith(delivery);
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        rawBody: expect.stringContaining('"text":"resposta NPS"')
      })
    );
    expect(delivery.payload.data).toEqual({});
  });

  it("pauses immediately on 401 without retrying", async () => {
    const pauseSubscription = jest.fn();
    const deadLetter = jest.fn();
    const dispatcher = new WebhookDeliveryDispatcher({
      claimNext: jest.fn().mockResolvedValue(delivery),
      decryptSecret: jest.fn().mockReturnValue("secret"),
      getKeyring: jest.fn().mockReturnValue({ activeKeyId: "v1", keys: {} }),
      post: jest.fn().mockResolvedValue({ status: 401, body: "unauthorized" }),
      complete: jest.fn(),
      retry: jest.fn(),
      deadLetter,
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
      pauseSubscription,
      now: jest.fn().mockReturnValue(new Date("2026-07-24T12:00:00.000Z")),
      jitter: jest.fn().mockReturnValue(0)
    });

    await expect(dispatcher.dispatchOne()).resolves.toEqual({
      status: "dead_letter"
    });
    expect(deadLetter).toHaveBeenCalledWith("del_1", 401, "HTTP_401");
    expect(pauseSubscription).toHaveBeenCalledWith("sub_1");
  });
});
