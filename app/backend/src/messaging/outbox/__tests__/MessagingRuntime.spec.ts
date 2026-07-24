import MessagingRuntime from "../MessagingRuntime";

describe("MessagingRuntime", () => {
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
      { fanoutOne: jest.fn().mockResolvedValueOnce({ status: "created", deliveries: 2 }).mockResolvedValue({ status: "idle", deliveries: 0 }) },
      { dispatchOne: jest.fn().mockResolvedValueOnce({ status: "delivered" }).mockResolvedValue({ status: "idle" }) }
    );

    await expect(runtime.runOnce()).resolves.toEqual({
      recovered: 1,
      dispatched: 1,
      processedInbox: 1,
      webhookDeliveriesCreated: 2,
      webhooksDispatched: 1
    });
    expect(events).toEqual(["recover", "inbox", "dispatch"]);
  });
});
