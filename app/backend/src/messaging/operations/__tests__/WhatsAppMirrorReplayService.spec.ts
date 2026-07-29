import WhatsAppMirrorReplayService from "../WhatsAppMirrorReplayService";

describe("WhatsAppMirrorReplayService", () => {
  const runId = "11111111-1111-4111-8111-111111111111";

  it("publishes a unique synthetic provider event without invoking a send provider", async () => {
    const published: any[] = [];
    const service = new WhatsAppMirrorReplayService({
      publish: async events => {
        published.push(...events);
      },
      now: () => new Date("2026-01-01T00:00:00.000Z")
    });

    await expect(
      service.replay(7, {
        runId,
        sequence: 12,
        whatsappId: 3,
        fixture: {
          name: "baileys-rich-v1",
          provider: "baileys",
          event: {
            eventType: "button.clicked",
            kind: "interactive",
            text: "Synthetic choice",
            actorType: "contact",
            fromMe: false,
            interactive: {
              type: "button",
              id: "fixture-choice-1",
              title: "Synthetic option"
            }
          }
        }
      })
    ).resolves.toEqual({ accepted: true, sequence: 12 });

    expect(published).toHaveLength(1);
    expect(published[0]).toEqual(
      expect.objectContaining({
        companyId: 7,
        eventType: "button.clicked",
        occurredAt: new Date("2026-01-01T00:00:00.000Z")
      })
    );
    expect(published[0].payload).toEqual(
      expect.objectContaining({
        origin: "provider",
        whatsappId: 3,
        conversationId: `fixture-${runId}`,
        contactId: `fixture-${runId}`,
        externalTicketId: `fixture-${runId}`,
        automationEpoch: 1,
        actorType: "contact"
      })
    );
    expect(published[0].payload.connection.phoneNumber).toBeNull();
    expect(published[0].payload.contact).toMatchObject({
      jid: null,
      lid: null,
      phoneNumber: null
    });
    expect(JSON.stringify(published[0])).not.toMatch(
      /@s\.whatsapp\.net|authorization|secret|5511\d+/i
    );
  });

  it("rejects free-form identity, URL and secret fields at the server trust boundary", async () => {
    const service = new WhatsAppMirrorReplayService({
      publish: async () => undefined
    });

    await expect(
      service.replay(7, {
        runId,
        sequence: 1,
        whatsappId: 3,
        fixture: {
          name: "meta-rich-v1",
          provider: "meta_cloud",
          event: {
            eventType: "message.received",
            kind: "text",
            phoneNumber: "synthetic-phone"
          }
        }
      } as any)
    ).rejects.toThrow("phoneNumber");
  });
});
