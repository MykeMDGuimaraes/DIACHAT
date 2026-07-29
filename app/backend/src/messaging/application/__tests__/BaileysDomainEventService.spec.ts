import BaileysDomainEventService, {
  extractSelectedButtonId
} from "../BaileysDomainEventService";

describe("BaileysDomainEventService", () => {
  it.each([
    [
      {
        message: {
          buttonsResponseMessage: { selectedButtonId: "nps:ticket_1-score-10" }
        }
      },
      "nps:ticket_1-score-10"
    ],
    [
      {
        message: {
          templateButtonReplyMessage: { selectedId: "callback:_:-" }
        }
      },
      "callback:_:-"
    ],
    [
      {
        message: {
          listResponseMessage: {
            singleSelectReply: { selectedRowId: "row:id_1-x" }
          }
        }
      },
      "row:id_1-x"
    ]
  ])("preserves selected callback byte for byte", (raw, expected) => {
    expect(extractSelectedButtonId(raw)).toBe(expected);
  });

  it("extracts a native-flow quick reply id byte for byte", () => {
    const selected = "accept:ticket_1-with_under-score";
    expect(
      extractSelectedButtonId({
        message: {
          interactiveResponseMessage: {
            nativeFlowResponseMessage: {
              paramsJson: JSON.stringify({
                id: selected,
                display_text: "Aceitar"
              })
            }
          }
        }
      })
    ).toBe(selected);
  });

  it("ignores malformed or oversized native-flow response params", () => {
    expect(
      extractSelectedButtonId({
        message: {
          interactiveResponseMessage: {
            nativeFlowResponseMessage: { paramsJson: "{" }
          }
        }
      })
    ).toBeNull();
    expect(
      extractSelectedButtonId({
        message: {
          interactiveResponseMessage: {
            nativeFlowResponseMessage: {
              paramsJson: JSON.stringify({ id: "x".repeat(257) })
            }
          }
        }
      })
    ).toBeNull();
  });

  it("publishes contact and button events once with canonical correlation", async () => {
    const dependencies = {
      transaction: jest.fn((callback: any) => callback("tx")),
      findAutomationState: jest.fn().mockResolvedValue({
        externalTicketId: "external-1",
        automationEpoch: 8
      }),
      findOrCreateEvent: jest.fn().mockResolvedValue(undefined)
    };
    const service = new BaileysDomainEventService(dependencies as any);

    await service.publish({
      companyId: 7,
      message: {
        id: "provider-message-1",
        fromMe: false,
        mediaType: "buttonsResponseMessage",
        dataJson: JSON.stringify({
          message: {
            buttonsResponseMessage: {
              selectedButtonId: "nps:external_1-score-10"
            }
          }
        })
      } as any,
      ticket: {
        uuid: "conversation-uuid",
        whatsappId: 2,
        contactId: 22,
        userId: 9
      } as any
    });

    expect(dependencies.findOrCreateEvent).toHaveBeenCalledTimes(2);
    expect(dependencies.findOrCreateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "message.received",
        payload: expect.objectContaining({
          actorType: "contact",
          externalTicketId: "external-1",
          automationEpoch: 8,
          conversationId: "conversation-uuid",
          contactId: "22"
        })
      }),
      "tx"
    );
    expect(dependencies.findOrCreateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "button.clicked",
        payload: expect.objectContaining({
          selectedId: "nps:external_1-score-10"
        })
      }),
      "tx"
    );
  });

  it("classifies a non-API outbound persisted message as human", async () => {
    const dependencies = {
      transaction: jest.fn((callback: any) => callback("tx")),
      findAutomationState: jest.fn().mockResolvedValue(null),
      findOrCreateEvent: jest.fn().mockResolvedValue(undefined)
    };
    const service = new BaileysDomainEventService(dependencies as any);

    await service.publish({
      companyId: 7,
      message: {
        id: "human-message-1",
        fromMe: true,
        mediaType: "conversation",
        dataJson: "{}"
      } as any,
      ticket: {
        uuid: "conversation-uuid",
        whatsappId: 2,
        contactId: 22,
        userId: 9
      } as any
    });

    expect(dependencies.findOrCreateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "message.received",
        payload: expect.objectContaining({ actorType: "human" })
      }),
      "tx"
    );
  });

  it("publishes a PII-free conversation.created for an inbound ticket once", async () => {
    const dependencies = {
      transaction: jest.fn((callback: any) => callback("tx")),
      findAutomationState: jest.fn().mockResolvedValue(null),
      findOrCreateEvent: jest.fn().mockResolvedValue(undefined)
    };
    const service = new BaileysDomainEventService(dependencies as any);

    await service.publishConversationCreated({
      companyId: 7,
      ticket: {
        uuid: "conversation-uuid",
        whatsappId: 2,
        contactId: 22
      } as any
    });

    expect(dependencies.findOrCreateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "conversation.created",
        aggregateId: "conversation-uuid",
        payload: {
          conversationId: "conversation-uuid",
          contactId: "22",
          whatsappId: 2,
          externalTicketId: null,
          automationEpoch: null,
          actorType: "contact",
          origin: "provider"
        }
      }),
      "tx"
    );
  });

  it("persists conversation.created in the caller transaction", async () => {
    const dependencies = {
      transaction: jest.fn(),
      findAutomationState: jest.fn().mockResolvedValue(null),
      findOrCreateEvent: jest.fn().mockResolvedValue(undefined)
    };
    const service = new BaileysDomainEventService(dependencies as any);

    await service.persistConversationCreated(
      {
        companyId: 7,
        ticket: {
          uuid: "conversation-uuid",
          whatsappId: 2,
          contactId: 22
        } as any
      },
      "ticket-create-tx"
    );

    expect(dependencies.transaction).not.toHaveBeenCalled();
    expect(dependencies.findOrCreateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "conversation.created",
        aggregateId: "conversation-uuid"
      }),
      "ticket-create-tx"
    );
  });

  it("marks a conversation created by a legacy API send as API-originated", async () => {
    const dependencies = {
      transaction: jest.fn(),
      findAutomationState: jest.fn().mockResolvedValue(null),
      findOrCreateEvent: jest.fn().mockResolvedValue(undefined)
    };
    const service = new BaileysDomainEventService(dependencies as any);

    await service.persistConversationCreated(
      {
        companyId: 7,
        ticket: {
          uuid: "conversation-uuid",
          whatsappId: 2,
          contactId: 22
        } as any,
        actorType: "system",
        origin: "api"
      },
      "ticket-create-tx"
    );

    expect(dependencies.findOrCreateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          actorType: "system",
          origin: "api"
        })
      }),
      "ticket-create-tx"
    );
  });

  it("does not duplicate API-origin outbound events", async () => {
    const dependencies = {
      transaction: jest.fn(),
      findAutomationState: jest.fn(),
      findOrCreateEvent: jest.fn()
    };
    const service = new BaileysDomainEventService(dependencies as any);

    await service.publish({
      companyId: 7,
      message: {
        id: "api-message-1",
        fromMe: true,
        dataJson: JSON.stringify({ origin: "api" })
      } as any,
      ticket: { uuid: "conversation-uuid", whatsappId: 2 } as any
    });

    expect(dependencies.transaction).not.toHaveBeenCalled();
  });

  it("publishes correlated status updates only for API commands", async () => {
    const dependencies = {
      transaction: jest.fn((callback: any) => callback("tx")),
      findAutomationState: jest.fn(),
      findCommandByMessageId: jest.fn().mockResolvedValue({
        id: "command-1",
        messageId: "message-1",
        conversationId: "conversation-uuid",
        contactId: "22",
        externalTicketId: "external-1",
        automationEpoch: 8,
        whatsappId: 2
      }),
      findOrCreateEvent: jest.fn().mockResolvedValue(undefined)
    };
    const service = new BaileysDomainEventService(dependencies as any);

    await service.publishStatus({
      companyId: 7,
      messageId: "message-1",
      ack: 4
    });

    expect(dependencies.findOrCreateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "message.status.updated",
        aggregateId: "message-1:read",
        payload: expect.objectContaining({
          commandId: "command-1",
          messageId: "message-1",
          status: "read",
          externalTicketId: "external-1",
          automationEpoch: 8
        })
      }),
      "tx"
    );
  });

  it("correlates a provider ACK to the local API message without duplicating it", async () => {
    const localMessage = {
      id: "local-message-1",
      companyId: 7,
      ticketId: 91
    };
    const dependencies = {
      transaction: jest.fn((callback: any) => callback("tx")),
      findCommandByProviderMessageId: jest.fn().mockResolvedValue({
        id: "command-1",
        messageId: "local-message-1"
      }),
      findMessage: jest.fn().mockResolvedValue(localMessage),
      updateMessage: jest.fn().mockResolvedValue(localMessage),
      findCommandByMessageId: jest.fn().mockResolvedValue({
        id: "command-1",
        messageId: "local-message-1",
        conversationId: "conversation-uuid",
        contactId: "22",
        externalTicketId: "external-1",
        automationEpoch: 8,
        whatsappId: 2
      }),
      findOrCreateEvent: jest.fn().mockResolvedValue(undefined)
    };
    const service = new BaileysDomainEventService(dependencies as any);

    await expect(
      service.acknowledgeProviderMessage({
        companyId: 7,
        providerMessageId: "wa-provider-1",
        ack: 4
      })
    ).resolves.toBe(localMessage);

    expect(dependencies.findMessage).toHaveBeenCalledWith(
      7,
      "local-message-1",
      "tx"
    );
    expect(dependencies.updateMessage).toHaveBeenCalledWith(
      localMessage,
      { ack: 4 },
      "tx"
    );
    expect(dependencies.findOrCreateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "message.status.updated",
        aggregateId: "local-message-1:read"
      }),
      "tx"
    );
  });

  it("recognizes an API provider id so the echoed upsert can be skipped", async () => {
    const dependencies = {
      transaction: jest.fn((callback: any) => callback("tx")),
      findCommandByProviderMessageId: jest.fn().mockResolvedValue({
        id: "command-1"
      })
    };
    const service = new BaileysDomainEventService(dependencies as any);

    await expect(
      service.isApiProviderMessage(7, "wa-provider-1")
    ).resolves.toBe(true);
  });
});
