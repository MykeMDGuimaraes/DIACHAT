import ApiCredentialService from "../ApiCredentialService";

describe("ApiCredentialService", () => {
  it("returns the secret only at issue time and persists only its HMAC", async () => {
    const create = jest.fn().mockResolvedValue({ id: "cred_1" });
    const service = new ApiCredentialService(
      { create },
      () => "pepper",
      () => "abc123def456ghi789jkl012"
    );

    const result = await service.issue({
      companyId: 10,
      name: "n8n",
      scopes: ["messages:write"],
      connectionIds: [2]
    });

    expect(result.apiKey).toBe(
      "dch_live_abc123def456ghi789jkl012.abc123def456ghi789jkl012"
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 10,
        tokenId: "abc123def456ghi789jkl012",
        secretHash: expect.any(String),
        scopes: ["messages:write"],
        connectionIds: [2]
      })
    );
    expect(create.mock.calls[0][0].secretHash).not.toContain("abc123def456ghi789jkl012");
  });

  it("issues the least-privilege scopes required by the Router integration", async () => {
    const create = jest.fn().mockResolvedValue({ id: "cred_router" });
    const service = new ApiCredentialService(
      { create },
      () => "pepper",
      () => "router123456789012345678"
    );

    await expect(
      service.issue({
        companyId: 10,
        name: "Roteador",
        scopes: [
          "messages:write",
          "conversations:write",
          "integration:read",
          "transcript:read"
        ],
        connectionIds: [2]
      })
    ).resolves.toMatchObject({ credential: { id: "cred_router" } });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: [
          "messages:write",
          "conversations:write",
          "integration:read",
          "transcript:read"
        ]
      })
    );
  });
});
