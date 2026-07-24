import MetaInboxProcessor from "../MetaInboxProcessor";

describe("MetaInboxProcessor", () => {
  it("persists normalized messages and statuses before completing the inbox item", async () => {
    const persistMessage = jest.fn();
    const persistStatus = jest.fn();
    const complete = jest.fn();
    const processor = new MetaInboxProcessor({
      claimNext: jest.fn().mockResolvedValue({
        id: "inbox_1",
        companyId: 7,
        whatsappId: 42,
        payload: {
          entry: [{ changes: [{ value: {
            messages: [{ id: "wamid.in", from: "5511999999999", type: "text", text: { body: "Oi" } }],
            statuses: [{ id: "wamid.out", status: "read" }]
          } }] }]
        }
      }),
      persistMessage,
      persistStatus,
      complete,
      release: jest.fn()
    });

    await expect(processor.processOne()).resolves.toEqual({ status: "processed" });
    expect(persistMessage).toHaveBeenCalledWith(7, 42, expect.objectContaining({ providerMessageId: "wamid.in" }));
    expect(persistStatus).toHaveBeenCalledWith(7, 42, expect.objectContaining({ providerMessageId: "wamid.out", ack: 4 }));
    expect(complete).toHaveBeenCalledWith("inbox_1");
  });

  it("releases an inbox item for retry when processing fails", async () => {
    const release = jest.fn();
    const processor = new MetaInboxProcessor({
      claimNext: jest.fn().mockResolvedValue({ id: "inbox_1", companyId: 7, whatsappId: 42, payload: { entry: [] } }),
      persistMessage: jest.fn().mockRejectedValue(new Error("temporary")),
      persistStatus: jest.fn(),
      complete: jest.fn(),
      release
    });
    jest.spyOn(processor, "parse").mockReturnValue({ messages: [{ providerMessageId: "x" } as any], statuses: [] });

    await expect(processor.processOne()).resolves.toEqual({ status: "retry" });
    expect(release).toHaveBeenCalledWith("inbox_1", "temporary");
  });
});
