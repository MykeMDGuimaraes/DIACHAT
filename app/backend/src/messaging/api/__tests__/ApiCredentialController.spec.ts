import { createIssueApiCredentialHandler } from "../ApiCredentialController";

describe("ApiCredentialController", () => {
  it("allows an administrator to issue a tenant-scoped API key", async () => {
    const issue = jest.fn().mockResolvedValue({
      credential: { id: "cred_1", name: "n8n" },
      apiKey: "dch_live_token.secret"
    });
    const handler = createIssueApiCredentialHandler({ issue });
    const req: any = {
      user: { companyId: 10, profile: "admin" },
      body: { name: "n8n", scopes: ["messages:write"], connectionIds: [2] }
    };
    const res: any = { status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);

    await handler(req, res);

    expect(issue).toHaveBeenCalledWith({
      companyId: 10,
      name: "n8n",
      scopes: ["messages:write"],
      connectionIds: [2]
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      id: "cred_1",
      name: "n8n",
      apiKey: "dch_live_token.secret"
    });
  });
});
