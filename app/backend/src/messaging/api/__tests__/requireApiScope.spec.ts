import requireApiScope from "../requireApiScope";

describe("requireApiScope", () => {
  it("allows a credential that contains the required scope", () => {
    const next = jest.fn();
    const middleware = requireApiScope("messages:write");

    middleware(
      { apiCredential: { scopes: ["messages:write"] } } as any,
      {} as any,
      next
    );

    expect(next).toHaveBeenCalledWith();
  });

  it("rejects a credential without the required scope", () => {
    const middleware = requireApiScope("messages:write");

    expect(() =>
      middleware(
        { apiCredential: { scopes: ["messages:read"] } } as any,
        {} as any,
        jest.fn()
      )
    ).toThrow("Escopo de API insuficiente");
  });
});
