import WebhookDeliveryDispatcher, {
  nextSubscriptionFailureState,
  WEBHOOK_DEAD_LETTER_RETENTION_MS
} from "../WebhookDeliveryDispatcher";

const rawBody =
  "{\"schema\":\"whatsapp-mirror/1\",\"id\":\"mirror_evt_1\"}";
const delivery = {
  id: "del_1",
  companyId: 7,
  subscriptionId: "sub_1",
  eventId: "evt_1",
  eventType: "message.received",
  urlSnapshot: "https://hooks.example.com/diachat",
  methodSnapshot: "POST",
  secretCiphertextSnapshot: "ciphertext",
  payload: { messageId: "msg_1", whatsappId: 42 },
  attemptCount: 1,
  leaseToken: "delivery-lease-1",
  bodyCiphertext: "encrypted-body",
  bodyKeyVersion: "v2",
  bodySha256: "body-digest"
};

const decryptBody = () =>
  jest.fn().mockReturnValue(Buffer.from(rawBody, "utf8"));

const dependencies = (overrides: Record<string, unknown> = {}) =>
  ({
    claimNext: jest.fn().mockResolvedValue(delivery),
    decryptBody: decryptBody(),
    decryptSecret: jest.fn().mockReturnValue("signing-secret"),
    getKeyring: jest
      .fn()
      .mockReturnValue({ activeKeyId: "v1", keys: { v1: "unused" } }),
    post: jest.fn().mockResolvedValue({ status: 204, body: "" }),
    complete: jest.fn(),
    retry: jest.fn(),
    deadLetter: jest.fn(),
    recordSuccess: jest.fn(),
    recordFailure: jest.fn(),
    pauseSubscription: jest.fn(),
    now: jest.fn().mockReturnValue(new Date("2026-07-24T12:00:00.000Z")),
    jitter: jest.fn().mockReturnValue(0),
    ...overrides
  } as any);

describe("WebhookDeliveryDispatcher", () => {
  it("posts exactly signed decrypted bytes and completes with the claim fence", async () => {
    const post = jest.fn().mockResolvedValue({ status: 204, body: "" });
    const complete = jest.fn();
    const dispatcher = new WebhookDeliveryDispatcher(
      dependencies({ post, complete })
    );

    await expect(dispatcher.dispatchOne()).resolves.toEqual({
      status: "delivered"
    });
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        url: delivery.urlSnapshot,
        rawBody,
        headers: expect.objectContaining({
          "X-DiaChat-Timestamp": "1784894400",
          "X-DiaChat-Signature": expect.stringMatching(/^sha256=/),
          "X-DiaChat-Delivery": "del_1",
          "X-DiaChat-Event": "evt_1"
        })
      })
    );
    expect(complete).toHaveBeenCalledWith(
      "del_1",
      "delivery-lease-1",
      204
    );
  });

  it("requeues retryable failures with a bounded fenced backoff", async () => {
    const retry = jest.fn();
    const dispatcher = new WebhookDeliveryDispatcher(
      dependencies({
        post: jest.fn().mockResolvedValue({ status: 503, body: "unavailable" }),
        retry
      })
    );

    await expect(dispatcher.dispatchOne()).resolves.toEqual({
      status: "retry"
    });
    expect(retry).toHaveBeenCalledWith(
      "del_1",
      "delivery-lease-1",
      new Date("2026-07-24T12:00:02.000Z"),
      503,
      "HTTP_503"
    );
  });

  it("dead-letters the sixth failure and retains its body for 168 hours", async () => {
    const deadLetter = jest.fn();
    const dispatcher = new WebhookDeliveryDispatcher(
      dependencies({
        claimNext: jest
          .fn()
          .mockResolvedValue({ ...delivery, attemptCount: 6 }),
        post: jest.fn().mockRejectedValue(new Error("timeout")),
        deadLetter
      })
    );

    await expect(dispatcher.dispatchOne()).resolves.toEqual({
      status: "dead_letter"
    });
    expect(deadLetter).toHaveBeenCalledWith(
      "del_1",
      "delivery-lease-1",
      new Date("2026-07-31T12:00:00.000Z"),
      undefined,
      "WEBHOOK_DELIVERY_ERROR"
    );
  });

  it("requeues a delivery when loading the keyring fails", async () => {
    const retry = jest.fn();
    const dispatcher = new WebhookDeliveryDispatcher(
      dependencies({
        getKeyring: jest.fn(() => {
          throw new Error("keyring unavailable");
        }),
        post: jest.fn(),
        retry
      })
    );

    await expect(dispatcher.dispatchOne()).resolves.toEqual({
      status: "retry"
    });
    expect(retry).toHaveBeenCalledWith(
      "del_1",
      "delivery-lease-1",
      expect.any(Date),
      undefined,
      "WEBHOOK_DELIVERY_ERROR"
    );
  });

  it("dead-letters the sixth signing-secret decryption failure", async () => {
    const deadLetter = jest.fn();
    const recordFailure = jest.fn();
    const dispatcher = new WebhookDeliveryDispatcher(
      dependencies({
        claimNext: jest
          .fn()
          .mockResolvedValue({ ...delivery, attemptCount: 6 }),
        decryptSecret: jest.fn(() => {
          throw new Error("invalid signing secret");
        }),
        deadLetter,
        recordFailure
      })
    );

    await expect(dispatcher.dispatchOne()).resolves.toEqual({
      status: "dead_letter"
    });
    expect(deadLetter).toHaveBeenCalledWith(
      "del_1",
      "delivery-lease-1",
      new Date("2026-07-31T12:00:00.000Z"),
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

  it("decrypts by immutable identifiers and never rebuilds from JSONB", async () => {
    const decryptDurableBody = decryptBody();
    const post = jest.fn().mockResolvedValue({ status: 202, body: "" });
    const dispatcher = new WebhookDeliveryDispatcher(
      dependencies({ decryptBody: decryptDurableBody, post })
    );

    await dispatcher.dispatchOne();

    expect(decryptDurableBody).toHaveBeenCalledWith(
      {
        bodyCiphertext: "encrypted-body",
        bodyKeyVersion: "v2",
        bodySha256: "body-digest"
      },
      {
        companyId: 7,
        subscriptionId: "sub_1",
        deliveryId: "del_1",
        eventId: "evt_1"
      },
      { activeKeyId: "v1", keys: { v1: "unused" } }
    );
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ rawBody }));
  });

  it("pauses immediately on 401 with fenced dead-letter retention", async () => {
    const pauseSubscription = jest.fn();
    const deadLetter = jest.fn();
    const dispatcher = new WebhookDeliveryDispatcher(
      dependencies({
        post: jest.fn().mockResolvedValue({ status: 401, body: "unauthorized" }),
        deadLetter,
        pauseSubscription
      })
    );

    await expect(dispatcher.dispatchOne()).resolves.toEqual({
      status: "dead_letter"
    });
    expect(deadLetter).toHaveBeenCalledWith(
      "del_1",
      "delivery-lease-1",
      new Date("2026-07-31T12:00:00.000Z"),
      401,
      "HTTP_401"
    );
    expect(pauseSubscription).toHaveBeenCalledWith("sub_1");
  });

  it("does not record success after a stale completion fence", async () => {
    const recordSuccess = jest.fn();
    const dispatcher = new WebhookDeliveryDispatcher(
      dependencies({
        complete: jest.fn().mockResolvedValue([0]),
        recordSuccess
      })
    );

    await expect(dispatcher.dispatchOne()).resolves.toEqual({ status: "idle" });
    expect(recordSuccess).not.toHaveBeenCalled();
  });

  it("defines dead-letter encrypted retention as exactly 168 hours", () => {
    expect(WEBHOOK_DEAD_LETTER_RETENTION_MS).toBe(168 * 60 * 60 * 1000);
  });
});
