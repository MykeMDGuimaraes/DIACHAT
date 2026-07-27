jest.mock("../../persistence/models/ApiCredential", () => ({
  __esModule: true,
  default: { findOne: jest.fn() }
}));

import apiKeyAuth from "../apiKeyAuth";
import ApiCredential from "../../persistence/models/ApiCredential";
import { hashApiKeySecret } from "../../domain/PublicApiKey";

describe("apiKeyAuth", () => {
  beforeEach(() => {
    process.env.API_KEY_PEPPER = "test-pepper";
  });

  it("attaches an active credential principal to the request", async () => {
    (ApiCredential.findOne as jest.Mock).mockResolvedValue({
      id: "cred_1",
      companyId: 10,
      scopes: ["messages:write"],
      connectionIds: [2],
      secretHash: hashApiKeySecret("secret-value-12345678", "test-pepper"),
      update: jest.fn()
    });
    const req: any = {
      headers: {
        authorization: "Bearer dch_live_token_12345678.secret-value-12345678"
      }
    };
    const next = jest.fn();

    await apiKeyAuth(req, {} as any, next);

    expect(req.apiCredential).toEqual({
      id: "cred_1",
      companyId: 10,
      scopes: ["messages:write"],
      connectionIds: [2]
    });
    expect(next).toHaveBeenCalledWith();
  });
});
