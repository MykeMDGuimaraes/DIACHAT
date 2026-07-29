import { messagingCapacityReplay } from "../MessagingOperationsController";

jest.mock("../../../libs/wbot", () => ({ getWbotSessionIds: () => [] }));

describe("messagingCapacityReplay", () => {
  const originalEnvironment = process.env;

  afterEach(() => {
    process.env = originalEnvironment;
  });

  it("is unavailable unless staging, mirror and replay flags are all enabled", async () => {
    process.env = {
      ...originalEnvironment,
      NODE_ENV: "test",
      MESSAGING_WEBHOOK_REPLAY_ENABLED: "true",
      MESSAGING_WEBHOOK_MIRROR_V1_ENABLED: "true"
    };

    await expect(
      messagingCapacityReplay(
        { user: { companyId: 7 }, body: {} } as any,
        {} as any
      )
    ).rejects.toMatchObject({
      message: "CAPACITY_REPLAY_DISABLED",
      statusCode: 404
    });
  });
});
