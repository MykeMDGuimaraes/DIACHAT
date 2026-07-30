import IntegrationReadinessService from "../IntegrationReadinessService";

describe("IntegrationReadinessService", () => {
  it("is ready only for an authorized connected Baileys channel and both real queues", async () => {
    const service = new IntegrationReadinessService({
      findConnection: jest.fn().mockResolvedValue({
        id: 2,
        status: "CONNECTED",
        channelType: "baileys"
      }),
      findQueues: jest
        .fn()
        .mockResolvedValue([{ id: 11, name: "Automacao" }, { id: 12, name: "Humano" }])
    });

    await expect(
      service.check({
        companyId: 7,
        allowedConnectionIds: [2],
        connectionId: 2,
        automationQueueId: "11",
        humanQueueId: "12"
      })
    ).resolves.toEqual({
      ready: true,
      connection: { id: 2, status: "connected" },
      queues: [
        { id: "11", name: "Automacao" },
        { id: "12", name: "Humano" }
      ],
      capabilities: { buttons: true }
    });
  });

  it("reports not ready instead of accepting a disconnected channel", async () => {
    const service = new IntegrationReadinessService({
      findConnection: jest.fn().mockResolvedValue({
        id: 2,
        status: "DISCONNECTED",
        channelType: "baileys"
      }),
      findQueues: jest.fn().mockResolvedValue([{ id: 11 }, { id: 12 }])
    });

    await expect(
      service.check({
        companyId: 7,
        allowedConnectionIds: [2],
        connectionId: 2,
        automationQueueId: "11",
        humanQueueId: "12"
      })
    ).resolves.toMatchObject({
      ready: false,
      connection: { id: 2, status: "disconnected" }
    });
  });
});
