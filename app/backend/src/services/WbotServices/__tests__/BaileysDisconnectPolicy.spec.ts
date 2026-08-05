import {
  classifyDisconnect,
  decideDisconnect,
  WA_BAD_SESSION,
  WA_CONNECTION_CLOSED,
  WA_CONNECTION_REPLACED,
  WA_FORBIDDEN,
  WA_LOGGED_OUT,
  WA_REJECTION_COOLDOWN,
  WA_RESTART_REQUIRED,
  WA_TIMED_OUT
} from "../BaileysDisconnectPolicy";

describe("BaileysDisconnectPolicy", () => {
  describe("classifyDisconnect", () => {
    it.each([
      [WA_LOGGED_OUT, "terminal"],
      [WA_FORBIDDEN, "terminal"],
      [WA_BAD_SESSION, "terminal"],
      [WA_CONNECTION_REPLACED, "terminal"],
      [WA_TIMED_OUT, "transient"],
      [WA_CONNECTION_CLOSED, "transient"],
      [WA_RESTART_REQUIRED, "transient"],
      [WA_REJECTION_COOLDOWN, "cooldown"],
      [undefined, "unknown"],
      [null, "unknown"],
      [999, "unknown"]
    ])("classifies %s as %s", (code, expected) => {
      expect(classifyDisconnect(code as number | null | undefined)).toBe(
        expected
      );
    });
  });

  describe("decideDisconnect", () => {
    it.each([WA_LOGGED_OUT, WA_FORBIDDEN, WA_BAD_SESSION])(
      "%s terminates and clears credential and baileys cache (real logout)",
      code => {
        const decision = decideDisconnect(code);
        expect(decision).toMatchObject({
          disconnectClass: "terminal",
          action: "terminate",
          clearCredential: true,
          clearBaileysCache: true,
          maxReconnectAttempts: 0
        });
      }
    );

    it("440 connectionReplaced never reconnects and never clears the credential", () => {
      const decision = decideDisconnect(WA_CONNECTION_REPLACED);
      expect(decision).toMatchObject({
        disconnectClass: "terminal",
        action: "terminate",
        reasonCode: "CONNECTION_REPLACED",
        clearCredential: false,
        clearBaileysCache: false,
        maxReconnectAttempts: 0
      });
    });

    it.each([
      [WA_TIMED_OUT, "TIMED_OUT"],
      [WA_CONNECTION_CLOSED, "CONNECTION_CLOSED"],
      [WA_RESTART_REQUIRED, "RESTART_REQUIRED"]
    ])("%s reconnects preserving credential and cache", (code, reasonCode) => {
      const decision = decideDisconnect(code);
      expect(decision).toMatchObject({
        disconnectClass: "transient",
        action: "reconnect",
        reasonCode,
        clearCredential: false,
        clearBaileysCache: false
      });
      expect(decision.maxReconnectAttempts).toBeGreaterThan(1);
    });

    it("463 stops the loop, preserves the credential and demands intervention", () => {
      const decision = decideDisconnect(WA_REJECTION_COOLDOWN);
      expect(decision).toMatchObject({
        disconnectClass: "cooldown",
        action: "terminate",
        reasonCode: "REJECTION_COOLDOWN",
        clearCredential: false,
        maxReconnectAttempts: 0
      });
    });

    it.each([[undefined], [null], [999]])(
      "unknown code %s gets exactly one controlled attempt",
      code => {
        const decision = decideDisconnect(code as number | null | undefined);
        expect(decision).toMatchObject({
          disconnectClass: "unknown",
          action: "reconnect",
          reasonCode: "UNKNOWN_DISCONNECT",
          clearCredential: false,
          maxReconnectAttempts: 1
        });
      }
    );
  });
});
