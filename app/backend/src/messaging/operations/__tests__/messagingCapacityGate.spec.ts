// The capacity runner is JavaScript so it can execute before the TypeScript app.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  buildInjectionMeasurements,
  buildReplayReport,
  fetchJsonWithTimeout,
  loadConfig,
  loadReplayConfig,
  percentile,
  validateReplayFixture
} = require("../../../../scripts/messagingCapacityGate.js");

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

  it("defaults replay to offline validation and fixes the approved capacity target", () => {
    expect(loadReplayConfig({})).toMatchObject({
      mode: "dry-validation",
      requestsPerSecond: 150,
      durationSeconds: 1800,
      drainDeadlineSeconds: 900,
      expectedEvents: 270000
    });
  });

  it("refuses live replay unless every staging-only safety prerequisite is explicit", () => {
    expect(() =>
      loadReplayConfig({ MESSAGING_WEBHOOK_REPLAY_RUN: "STAGING_ONLY" })
    ).toThrow("CAPACITY_ENVIRONMENT=staging");

    expect(() =>
      loadReplayConfig({
        MESSAGING_WEBHOOK_REPLAY_RUN: "STAGING_ONLY",
        CAPACITY_ENVIRONMENT: "staging",
        CAPACITY_TARGET_URL: "https://staging.diachat.example",
        CAPACITY_SERVICE_TOKEN: "secret",
        CAPACITY_REPLAY_WHATSAPP_ID: "7",
        CAPACITY_RECEIVER_METRICS_URL:
          "https://n8n-staging.example/webhook/capacity-status",
        CAPACITY_RPS: "149"
      })
    ).toThrow("150 eventos/s");
  });

  it("accepts only synthetic PII-free replay fixture fields", () => {
    const fixture = {
      name: "baileys-rich-v1",
      provider: "baileys",
      events: [
        {
          eventType: "message.received",
          kind: "text",
          text: "Synthetic capacity event",
          actorType: "contact"
        }
      ]
    };

    expect(validateReplayFixture(fixture)).toEqual(fixture);
    expect(() =>
      validateReplayFixture({
        ...fixture,
        events: [{ ...fixture.events[0], phoneNumber: "synthetic-phone" }]
      })
    ).toThrow("phoneNumber");
  });

  it("fails the report on loss, unexpected duplicates, plaintext or missed drain deadline", () => {
    const report = buildReplayReport(
      {
        expectedEvents: 270000,
        drainDeadlineSeconds: 900
      },
      {
        accepted: 270000,
        receiver: {
          received: 269999,
          expectedDuplicates: 0,
          unexpectedDuplicates: 1,
          signatureFailures: 0,
          plaintextViolations: 1
        },
        pipeline: {
          durableProjectionFailures: 1,
          durableCryptoFailures: 0,
          deadLettersDelta: 1
        },
        injectionElapsedSeconds: 1801,
        achievedRps: 149.92,
        drainSeconds: 901
      }
    );

    expect(report.gates).toEqual({
      zeroLoss: false,
      zeroUnexpectedDuplicates: false,
      zeroPlaintext: false,
      hmacVerified: true,
      drainedWithinDeadline: false,
      sustainedInjectionRate: false,
      pipelineHealthy: false
    });
    expect(report.passed).toBe(false);
    expect(JSON.stringify(report)).not.toContain("secret");
  });

  it("measures the sustained injection rate with a monotonic clock", () => {
    expect(buildInjectionMeasurements(270000, 10_000, 1_810_000)).toEqual({
      injectionElapsedSeconds: 1800,
      achievedRps: 150
    });
    expect(
      buildInjectionMeasurements(270000, 10_000, 1_811_000).achievedRps
    ).toBeLessThan(150);
  });

  it("aborts a hung request at the configured timeout", async () => {
    const hangingFetch = jest.fn((_url: string, options: any) => {
      expect(options.signal).toBeInstanceOf(AbortSignal);
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
        );
      });
    });

    await expect(
      fetchJsonWithTimeout(
        "https://staging.example/metrics",
        {},
        5,
        hangingFetch
      )
    ).rejects.toThrow("timeout");
  });
});
