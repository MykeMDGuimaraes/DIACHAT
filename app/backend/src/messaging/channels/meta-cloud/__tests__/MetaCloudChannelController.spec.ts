jest.mock("../CreateMetaCloudChannelService", () => ({
  createMetaCloudChannel: jest.fn()
}));

import { Request, Response } from "express";
import { createMetaCloudChannel } from "../CreateMetaCloudChannelService";
import { createMetaCloudChannelHandler } from "../MetaCloudChannelController";

describe("createMetaCloudChannelHandler", () => {
  beforeEach(() => {
    process.env.BACKEND_URL = "https://api.diachat.test";
  });

  afterEach(() => {
    delete process.env.BACKEND_URL;
    jest.resetAllMocks();
  });

  it("returns the one-time verify token and the Meta callback URL without exposing credentials", async () => {
    (createMetaCloudChannel as jest.Mock).mockResolvedValue({
      whatsappId: 42,
      credentialPublicId: "2b9a57a1-3cf1-4e6f-8c4f-7e0fe0354b1b",
      verifyToken: "verify-once",
      displayPhoneNumber: "+55 11 99999-9999"
    });
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const handler = createMetaCloudChannelHandler();

    await handler(
      {
        user: { companyId: 7 },
        body: {
          name: "Suporte",
          appId: "app_1",
          appSecret: "app-secret",
          accessToken: "access-token",
          wabaId: "waba_1",
          phoneNumberId: "phone_1"
        }
      } as unknown as Request,
      { status, json } as unknown as Response
    );

    expect(createMetaCloudChannel).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 7, appSecret: "app-secret" })
    );
    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith({
      whatsappId: 42,
      displayPhoneNumber: "+55 11 99999-9999",
      verifyToken: "verify-once",
      callbackUrl:
        "https://api.diachat.test/api/v1/channels/meta-cloud/2b9a57a1-3cf1-4e6f-8c4f-7e0fe0354b1b/webhook"
    });
  });
});
