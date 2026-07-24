import { createLegacyApiDeprecation } from "../legacyApiDeprecation";

describe("legacyApiDeprecation", () => {
  it("keeps the legacy endpoint available while advertising its successor", async () => {
    const createAudit = jest.fn().mockResolvedValue(undefined);
    const middleware = createLegacyApiDeprecation(createAudit, "Wed, 30 Sep 2026 00:00:00 GMT");
    const req: any = { originalUrl: "/api/messages/send", params: { whatsappId: "2" } };
    const res: any = { set: jest.fn() };
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.set).toHaveBeenCalledWith("Deprecation", "true");
    expect(res.set).toHaveBeenCalledWith("Sunset", "Wed, 30 Sep 2026 00:00:00 GMT");
    expect(res.set).toHaveBeenCalledWith(
      "Link",
      "</api/v1/messages>; rel=\"successor-version\""
    );
    expect(createAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: "legacy_api",
        action: "legacy_messages_send_accessed"
      })
    );
    expect(next).toHaveBeenCalled();
  });

  it("returns 410 only after sunset and fourteen quiet days", async () => {
    const createAudit = jest.fn().mockResolvedValue(undefined);
    const countRecentUsage = jest.fn().mockResolvedValue(0);
    const middleware = createLegacyApiDeprecation(
      createAudit,
      "Wed, 01 Jan 2025 00:00:00 GMT",
      countRecentUsage
    );
    const req: any = {
      originalUrl: "/api/messages/send",
      params: { whatsappId: "2" },
      user: { companyId: 7 }
    };
    const res: any = {
      set: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith({
      error: "LEGACY_ENDPOINT_GONE",
      successor: "/api/v1/messages"
    });
    expect(next).not.toHaveBeenCalled();
  });
});
