import WhatsAppMirrorReplayService from "../WhatsAppMirrorReplayService";

describe("WhatsAppMirrorReplayService", () => {
  const runId = "11111111-1111-4111-8111-111111111111";

  it("routes a synthetic Baileys raw fixture through the real adapter", async () => {
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
            adapter: "message",
            raw: {
              key: {
                id: "fixture-message-12",
                remoteJid: "000000000000@s.whatsapp.net",
                fromMe: false
              },
              messageTimestamp: 1767225600,
              message: {
                buttonsResponseMessage: {
                  selectedButtonId: "fixture-choice-1",
                  selectedDisplayText: "Synthetic option"
                }
              }
            }
          }
        }
      })
    ).resolves.toEqual({ accepted: true, sequence: 12 });

    expect(published).toHaveLength(2);
    expect(published[0]).toEqual(
      expect.objectContaining({
        companyId: 7,
        eventType: "message.received",
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
        actorType: "contact",
        kind: "button"
      })
    );
    expect(published[0].payload.connection.phoneNumber).toBeNull();
    expect(published[0].payload.contact).toMatchObject({
      jid: "000000000000@s.whatsapp.net",
      lid: null,
      phoneNumber: "000000000000"
    });
    expect(published.map(event => event.eventType)).toEqual([
      "message.received",
      "button.clicked"
    ]);
    expect(published[0].payload.provider.name).toBe("baileys");
    expect(JSON.stringify(published)).not.toMatch(
      /authorization|secret|(?:[1-9]\d{10,})@s\.whatsapp\.net/i
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
            adapter: "message",
            raw: {
              id: "fixture-meta-message",
              type: "text",
              text: { body: "Synthetic" },
              from: "000000000000",
              timestamp: "1767225600"
            },
            phoneNumber: "synthetic-phone"
          }
        }
      } as any)
    ).rejects.toThrow("phoneNumber");
  });
});
