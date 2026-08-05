import MessagingRuntime, {
  resolveWebhookRuntimeConcurrency
} from "../MessagingRuntime";

describe("MessagingRuntime", () => {
  it("uses bounded webhook pool defaults for production, staging, and explicit configuration", () => {
    expect(resolveWebhookRuntimeConcurrency({})).toEqual({
      fanout: 8,
      delivery: 32
    });
    expect(resolveWebhookRuntimeConcurrency({ NODE_ENV: "staging" })).toEqual({
      fanout: 8,
      delivery: 64
    });
    expect(
      resolveWebhookRuntimeConcurrency({
        MESSAGING_WEBHOOK_FANOUT_CONCURRENCY: "999",
        MESSAGING_WEBHOOK_DELIVERY_CONCURRENCY: "128"
      })
    ).toEqual({ fanout: 128, delivery: 128 });
    expect(
      resolveWebhookRuntimeConcurrency({
        MESSAGING_WEBHOOK_FANOUT_CONCURRENCY: "0",
        MESSAGING_WEBHOOK_DELIVERY_CONCURRENCY: "invalid"
      })
    ).toEqual({ fanout: 8, delivery: 32 });
  });

  it("drains webhook fanout and delivery through their configured concurrent pools", async () => {
    const concurrentRunner = (
      concurrency: number,
      activeState: { active: number; maximum: number },
      result: Record<string, unknown>
    ) => {
      let started = 0;
      let release: (() => void) | undefined;
      const barrier = new Promise<void>(resolve => {
        release = resolve;
      });
      return jest.fn(async () => {
        started += 1;
        activeState.active += 1;
        activeState.maximum = Math.max(activeState.maximum, activeState.active);
        if (started === concurrency) release?.();
        await barrier;
        activeState.active -= 1;
        return result;
      });
    };
    const fanoutState = { active: 0, maximum: 0 };
    const deliveryState = { active: 0, maximum: 0 };
    const fanoutOne = concurrentRunner(2, fanoutState, {
      status: "created",
      deliveries: 1
    });
    const dispatchWebhook = concurrentRunner(3, deliveryState, {
      status: "delivered"
    });
    const runtime = new MessagingRuntime(
      { recover: jest.fn().mockResolvedValue({ recovered: 0 }) },
      { dispatchOne: jest.fn().mockResolvedValue({ status: "idle" }) },
      1,
      undefined,
      { fanoutOne: fanoutOne as any },
      { dispatchOne: dispatchWebhook as any },
      undefined,
      undefined,
      undefined,
      { fanout: 2, delivery: 3 }
    );

    await expect(runtime.runOnce()).resolves.toEqual(
      expect.objectContaining({
        webhookDeliveriesCreated: 16,
        webhooksDispatched: 24
      })
    );
    expect(fanoutState.maximum).toBe(2);
    expect(deliveryState.maximum).toBe(3);
  });

  it("continues ready delivery work and reports a PII-free pool failure when a fanout lane rejects", async () => {
    const fanoutOne = jest
      .fn()
      .mockRejectedValueOnce(new Error("payload with private data"))
      .mockResolvedValue({ status: "created", deliveries: 2 });
    const dispatchWebhook = jest
      .fn()
      .mockResolvedValue({ status: "delivered" });
    const reportPoolFailure = jest.fn();
    const runtime = new MessagingRuntime(
      { recover: jest.fn().mockResolvedValue({ recovered: 0 }) },
      { dispatchOne: jest.fn().mockResolvedValue({ status: "idle" }) },
      1,
      undefined,
      { fanoutOne },
      { dispatchOne: dispatchWebhook },
      undefined,
      undefined,
      undefined,
      { fanout: 2, delivery: 1 },
      reportPoolFailure
    );

    await expect(runtime.runOnce()).resolves.toEqual(
      expect.objectContaining({
        webhookDeliveriesCreated: 2,
        webhooksDispatched: 8
      })
    );
    expect(dispatchWebhook).toHaveBeenCalledTimes(8);
    expect(reportPoolFailure).toHaveBeenCalledWith("fanout", 1);
    expect(JSON.stringify(reportPoolFailure.mock.calls)).not.toContain(
      "private data"
    );
  });

  it("adaptively drains backlog beyond one batch without waiting for the next tick", async () => {
    const fanoutOne = jest.fn();
    for (let index = 0; index < 30; index += 1) {
      fanoutOne.mockResolvedValueOnce({ status: "created", deliveries: 1 });
    }
    fanoutOne.mockResolvedValue({ status: "idle", deliveries: 0 });
    const runtime = new MessagingRuntime(
      { recover: jest.fn().mockResolvedValue({ recovered: 0 }) },
      { dispatchOne: jest.fn().mockResolvedValue({ status: "idle" }) },
      25,
      undefined,
      { fanoutOne },
      undefined,
      undefined,
      undefined,
      undefined,
      { fanout: 1, delivery: 1 }
    );

    await expect(runtime.runOnce()).resolves.toEqual(
      expect.objectContaining({ webhookDeliveriesCreated: 30 })
    );
    expect(fanoutOne).toHaveBeenCalledTimes(31);
  });

  it("recovers expired sends before draining ready outbox events", async () => {
    const events: string[] = [];
    const runtime = new MessagingRuntime(
      {
        recover: jest.fn().mockImplementation(async () => {
          events.push("recover");
          return { recovered: 1 };
        })
      },
      {
        dispatchOne: jest
          .fn()
          .mockImplementationOnce(async () => {
            events.push("dispatch");
            return { status: "sent" };
          })
          .mockResolvedValue({ status: "idle" })
      },
      5,
      {
        processOne: jest
          .fn()
          .mockImplementationOnce(async () => {
            events.push("inbox");
            return { status: "processed" as const };
          })
          .mockResolvedValue({ status: "idle" as const })
      },
      {
        fanoutOne: jest
          .fn()
          .mockResolvedValueOnce({ status: "created", deliveries: 2 })
          .mockResolvedValue({ status: "idle", deliveries: 0 })
      },
      {
        dispatchOne: jest
          .fn()
          .mockResolvedValueOnce({ status: "delivered" })
          .mockResolvedValue({ status: "idle" })
      }
    );

    await expect(runtime.runOnce()).resolves.toEqual({
      recovered: 1,
      dispatched: 1,
      processedInbox: 1,
      webhookDeliveriesCreated: 2,
      webhooksDispatched: 1,
      capacitySamplesObserved: 0,
      healthChangedChannels: []
    });
    expect(events).toEqual(["recover", "inbox", "dispatch"]);
  });

  it("continues draining inbox events after retry and dead-letter outcomes", async () => {
    const processOne = jest
      .fn()
      .mockResolvedValueOnce({ status: "retry" as const })
      .mockResolvedValueOnce({ status: "dead_letter" as const })
      .mockResolvedValueOnce({ status: "processed" as const })
      .mockResolvedValue({ status: "idle" as const });
    const runtime = new MessagingRuntime(
      { recover: jest.fn().mockResolvedValue({ recovered: 0 }) },
      { dispatchOne: jest.fn().mockResolvedValue({ status: "idle" }) },
      5,
      { processOne }
    );

    await expect(runtime.runOnce()).resolves.toEqual(
      expect.objectContaining({ processedInbox: 1 })
    );
    expect(processOne).toHaveBeenCalledTimes(4);
  });

  it("drains durable conversation commands in the same modular runtime", async () => {
    const conversationDispatch = jest
      .fn()
      .mockResolvedValueOnce({ status: "completed" })
      .mockResolvedValue({ status: "idle" });
    const runtime = new MessagingRuntime(
      { recover: jest.fn().mockResolvedValue({ recovered: 0 }) },
      { dispatchOne: jest.fn().mockResolvedValue({ status: "idle" }) },
      5,
      undefined,
      undefined,
      undefined,
      undefined,
      { dispatchOne: conversationDispatch }
    );

    await expect(runtime.runOnce()).resolves.toEqual(
      expect.objectContaining({ dispatched: 1 })
    );
    expect(conversationDispatch).toHaveBeenCalledTimes(2);
  });

  it("blocks all dispatch while active legacy plaintext remains", async () => {
    const recover = jest.fn().mockResolvedValue({ recovered: 0 });
    const webhookFanout = {
      fanoutOne: jest.fn().mockResolvedValue({ status: "idle", deliveries: 0 })
    };
    const webhookDispatcher = {
      dispatchOne: jest.fn().mockResolvedValue({ status: "idle" })
    };
    const runtime = new MessagingRuntime(
      { recover },
      { dispatchOne: jest.fn().mockResolvedValue({ status: "idle" }) },
      5,
      undefined,
      webhookFanout,
      webhookDispatcher,
      undefined,
      undefined,
      {
        runBatch: jest
          .fn()
          .mockResolvedValue({ processed: 100, safeToDispatch: false })
      }
    );

    await expect(runtime.runOnce()).resolves.toEqual({
      recovered: 0,
      dispatched: 0,
      processedInbox: 0,
      webhookDeliveriesCreated: 0,
      webhooksDispatched: 0,
      capacitySamplesObserved: 0,
      healthChangedChannels: []
    });
    expect(recover).not.toHaveBeenCalled();
    expect(webhookFanout.fanoutOne).not.toHaveBeenCalled();
    expect(webhookDispatcher.dispatchOne).not.toHaveBeenCalled();
  });

  it("propagates channels healed by Meta inbox confirmations for post-commit emit", async () => {
    const channel = { id: 42, deliveryHealth: "healthy" };
    const processOne = jest
      .fn()
      .mockResolvedValueOnce({
        status: "processed" as const,
        healthChangedChannels: [channel]
      })
      .mockResolvedValue({ status: "idle" as const });
    const runtime = new MessagingRuntime(
      { recover: jest.fn().mockResolvedValue({ recovered: 0 }) },
      { dispatchOne: jest.fn().mockResolvedValue({ status: "idle" }) },
      5,
      { processOne }
    );

    await expect(runtime.runOnce()).resolves.toMatchObject({
      processedInbox: 1,
      healthChangedChannels: [channel]
    });
  });
});
