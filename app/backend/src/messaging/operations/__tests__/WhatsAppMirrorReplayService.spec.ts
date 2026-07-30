import WhatsAppMirrorReplayService from "../WhatsAppMirrorReplayService";

describe("WhatsAppMirrorReplayService", () => {
  const runId = "11111111-1111-4111-8111-111111111111";

  it("routes a synthetic Baileys raw fixture through the real adapter", async () => {
    const published: any[] = [];
    const service = new WhatsAppMirrorReplayService({
      publish: async events => {
        published.push(...events);
      }
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

    expect(published).toHaveLength(1);
    expect(published[0]).toEqual(
      expect.objectContaining({
        companyId: 7,
        eventType: "button.clicked",
        occurredAt: expect.any(Date)
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
    expect(published.map(event => event.eventType)).toEqual(["button.clicked"]);
    expect(published[0].payload.provider.name).toBe("baileys");
    expect(published[0].payload.provider.eventId).toMatch(/^capacity-/);
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

  it("derives a unique aggregate per run and sequence while deduplicating an identical retry", async () => {
    const published: any[] = [];
    const service = new WhatsAppMirrorReplayService({
      publish: async events => {
        published.push(events[0]);
      }
    });
    const request = (currentRunId: string, sequence: number) => ({
      runId: currentRunId,
      sequence,
      whatsappId: 3,
      fixture: {
        name: "meta-rich-v2",
        provider: "meta_cloud" as const,
        event: {
          adapter: "message",
          raw: {
            id: "fixture-static-id",
            type: "text",
            text: { body: "Synthetic" },
            from: "000000000000",
            timestamp: "1767225600"
          }
        }
      }
    });

    await service.replay(7, request(runId, 1));
    await service.replay(7, request(runId, 2));
    await service.replay(7, request("22222222-2222-4222-8222-222222222222", 1));
    await service.replay(7, request(runId, 1));

    expect(published[0].aggregateId).not.toBe(published[1].aggregateId);
    expect(published[0].aggregateId).not.toBe(published[2].aggregateId);
    expect(published[0].aggregateId).toBe(published[3].aggregateId);
    expect(published[0].payload.provider.eventId).toBe(
      published[3].payload.provider.eventId
    );
  });
});
