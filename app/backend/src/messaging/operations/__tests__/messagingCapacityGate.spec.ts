// The capacity runner is JavaScript so it can execute before the TypeScript app.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { loadConfig, percentile } = require("../../../../scripts/messagingCapacityGate");

describe("messagingCapacityGate", () => {
  it("refuses to run without explicit opt-in and 20 real connection ids", () => {
    expect(() => loadConfig({})).toThrow("MESSAGING_CAPACITY_RUN=1");
    expect(() =>
      loadConfig({
        MESSAGING_CAPACITY_RUN: "1",
        CAPACITY_TARGET_URL: "https://diachat.example",
        CAPACITY_SERVICE_TOKEN: "token",
        CAPACITY_CONNECTION_IDS: "1,2"
      })
    ).toThrow("exatamente 20");
  });

  it("calculates the observed p95", () => {
    expect(percentile([5, 10, 15, 20, 100], 0.95)).toBe(100);
  });
});
