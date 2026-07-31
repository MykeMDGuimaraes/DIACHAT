import { deleteReactionHandler } from "../MessageMutationController";

describe("MessageMutationController", () => {
  it("removes a reaction without requiring a DELETE request body", async () => {
    const service = {
      create: jest.fn().mockResolvedValue({
        replayed: false,
        command: { responseSnapshot: { id: "command-1", status: "accepted" } }
      })
    };
    const request = {
      apiCredential: { id: "credential-1", companyId: 7, connectionIds: [2] },
      params: { messageId: "message-1" },
      body: {},
      header: jest.fn().mockReturnValue("legacy-client-key")
    } as any;
    const response = {
      set: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    } as any;
    const previous = process.env.MESSAGING_REACTIONS_V1_ENABLED;
    process.env.MESSAGING_REACTIONS_V1_ENABLED = "true";
    try {
      await deleteReactionHandler(service as any)(request, response);
    } finally {
      process.env.MESSAGING_REACTIONS_V1_ENABLED = previous;
    }
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({
      kind: "reaction",
      emoji: "",
      idempotencyKey: expect.stringMatching(/^server:/)
    }));
    expect(service.create.mock.calls[0][0].idempotencyKey).not.toBe("legacy-client-key");
    expect(response.status).toHaveBeenCalledWith(202);
    expect(response.set).not.toHaveBeenCalled();
  });
});
