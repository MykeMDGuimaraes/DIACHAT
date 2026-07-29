import {
  createFinalizeConversationHandler,
  createHandoffConversationHandler
} from "../ConversationController";

const response = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.set = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("ConversationController", () => {
  const request = (body: Record<string, unknown>) =>
    ({
      apiCredential: {
        id: "cred_1",
        companyId: 7,
        connectionIds: [2]
      },
      params: { conversationId: "conversation-uuid" },
      body,
      header: jest.fn().mockReturnValue("handoff-ticket-123")
    } as any);

  it("accepts a durable takeover command", async () => {
    const create = jest.fn().mockResolvedValue({
      command: { id: "cmd_handoff", conversationId: "conversation-uuid" },
      replayed: false
    });
    const handler = createHandoffConversationHandler({ create } as any);
    const res = response();

    await handler(
      request({
        action: "takeover",
        queueId: "12",
        userId: "9",
        externalTicketId: "ticket-uuid",
        automationEpoch: 4
      }),
      res
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "takeover",
        conversationId: "conversation-uuid",
        externalTicketId: "ticket-uuid",
        automationEpoch: 4
      })
    );
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({
      id: "cmd_handoff",
      status: "accepted",
      conversationId: "conversation-uuid"
    });
  });

  it("forces finalize to opt out of the native survey", async () => {
    const create = jest.fn().mockResolvedValue({
      command: { id: "cmd_finalize", conversationId: "conversation-uuid" },
      replayed: false
    });
    const handler = createFinalizeConversationHandler({ create } as any);

    await handler(
      request({
        externalTicketId: "ticket-uuid",
        automationEpoch: 4,
        sendNativeSurvey: false
      }),
      response()
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "finalize",
        sendNativeSurvey: false
      })
    );
  });
});
