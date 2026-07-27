jest.mock("../MetaWebhookVerificationService", () => ({
  verifyMetaWebhookChallenge: jest.fn()
}));
jest.mock("../IngestMetaWebhookService", () => ({
  ingestMetaWebhook: jest.fn()
}));

import { Request, Response } from "express";
import { ingestMetaWebhook } from "../IngestMetaWebhookService";
import {
  receiveMetaWebhookHandler,
  verifyMetaWebhookHandler
} from "../MetaWebhookController";
import { verifyMetaWebhookChallenge } from "../MetaWebhookVerificationService";

describe("Meta webhook handlers", () => {
  afterEach(() => jest.resetAllMocks());

  it("returns the Meta challenge after secure verification", async () => {
    (verifyMetaWebhookChallenge as jest.Mock).mockResolvedValue("challenge");
    const send = jest.fn();

    await verifyMetaWebhookHandler(
      {
        params: { credentialPublicId: "credential_1" },
        query: { "hub.mode": "subscribe", "hub.verify_token": "token", "hub.challenge": "challenge" }
      } as unknown as Request,
      { send } as unknown as Response
    );

    expect(send).toHaveBeenCalledWith("challenge");
  });

  it("passes the raw provider body and signature to durable ingestion", async () => {
    const sendStatus = jest.fn();
    await receiveMetaWebhookHandler(
      {
        params: { credentialPublicId: "credential_1" },
        rawBody: Buffer.from('{"object":"whatsapp_business_account"}'),
        body: { object: "whatsapp_business_account" },
        get: jest.fn().mockReturnValue("sha256=signature")
      } as unknown as Request,
      { sendStatus } as unknown as Response
    );

    expect(ingestMetaWebhook).toHaveBeenCalledWith({
      credentialPublicId: "credential_1",
      rawBody: '{"object":"whatsapp_business_account"}',
      signature: "sha256=signature",
      payload: { object: "whatsapp_business_account" }
    });
    expect(sendStatus).toHaveBeenCalledWith(200);
  });
});
