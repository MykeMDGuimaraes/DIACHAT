import { createPublicApiRateLimit } from "../publicApiRateLimit";

const response = () => {
  const result: any = {
    headers: {},
    status: jest.fn(() => result),
    json: jest.fn(() => result),
    setHeader: jest.fn((key, value) => {
      result.headers[key] = value;
    })
  };
  return result;
};

describe("publicApiRateLimit", () => {
  it("enforces per-company request and byte budgets per credential", async () => {
    const middleware = createPublicApiRateLimit(async () => ({
      requestsPerMinute: 1,
      uploadMbPerMinute: 0.00001
    }));
    const req: any = {
      apiCredential: { id: "cred-1", companyId: 9 },
      headers: { "content-length": "4" }
    };

    const first = response();
    await middleware(req, first, jest.fn());
    expect(first.status).not.toHaveBeenCalled();

    const second = response();
    await middleware(req, second, jest.fn());
    expect(second.status).toHaveBeenCalledWith(429);
    expect(second.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "RATE_LIMIT_EXCEEDED" })
    );
  });
});
