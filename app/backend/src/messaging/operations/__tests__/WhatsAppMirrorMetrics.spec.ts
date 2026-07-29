import {
  recordWhatsAppMirrorMetric,
  resetWhatsAppMirrorMetricsForTests,
  snapshotWhatsAppMirrorMetrics
} from "../WhatsAppMirrorMetrics";

describe("WhatsAppMirrorMetrics", () => {
  beforeEach(() => resetWhatsAppMirrorMetricsForTests());

  it("exposes only fixed aggregate counters without caller-provided labels", () => {
    recordWhatsAppMirrorMetric("projectionFailure");
    recordWhatsAppMirrorMetric("cryptoFailure");
    recordWhatsAppMirrorMetric("mediaAvailable");
    recordWhatsAppMirrorMetric("mediaUnavailable");
    recordWhatsAppMirrorMetric("mediaFailure");
    recordWhatsAppMirrorMetric("purgedBody", 3);

    const metrics = snapshotWhatsAppMirrorMetrics();

    expect(metrics).toEqual({
      projectionFailures: 1,
      cryptoFailures: 1,
      media: { available: 1, unavailable: 1, failures: 1 },
      purge: { encryptedBodies: 3 }
    });
    expect(JSON.stringify(metrics)).not.toMatch(
      /phone|jid|messageId|contact|conversation|url|secret/i
    );
  });
});
