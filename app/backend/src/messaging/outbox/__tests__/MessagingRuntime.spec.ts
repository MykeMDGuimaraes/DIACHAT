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
      }
    );

    await expect(runtime.runOnce()).resolves.toEqual({ recovered: 1, dispatched: 1, processedInbox: 1 });
    expect(events).toEqual(["recover", "inbox", "dispatch"]);
  });
});
