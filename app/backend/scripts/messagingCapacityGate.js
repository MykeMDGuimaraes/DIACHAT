const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const percentile = (values, quantile) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)
  ];
};

const loadConfig = environment => {
  if (environment.MESSAGING_CAPACITY_RUN !== "1") {
    throw new Error(
      "Capacity gate bloqueado: defina MESSAGING_CAPACITY_RUN=1 para usar 20 conexoes reais."
    );
  }
  const targetUrl = environment.CAPACITY_TARGET_URL;
  const serviceToken = environment.CAPACITY_SERVICE_TOKEN;
  const connectionIds = String(environment.CAPACITY_CONNECTION_IDS || "")
    .split(",")
    .filter(Boolean)
    .map(Number);
  if (!targetUrl || !serviceToken) {
    throw new Error(
      "CAPACITY_TARGET_URL e CAPACITY_SERVICE_TOKEN sao obrigatorios."
    );
  }
  if (
    connectionIds.length !== 20 ||
    connectionIds.some(id => !Number.isInteger(id)) ||
    new Set(connectionIds).size !== 20
  ) {
    throw new Error(
      "CAPACITY_CONNECTION_IDS deve conter exatamente 20 IDs reais e unicos."
    );
  }
  return {
    targetUrl: targetUrl.replace(/\/$/, ""),
    serviceToken,
    connectionIds,
    requestsPerSecond: Number(environment.CAPACITY_RPS || 50),
    durationSeconds: Number(environment.CAPACITY_DURATION_SECONDS || 1800),
    maxP95Ms: Number(environment.CAPACITY_MAX_P95_MS || 250),
    maxRssMb: Number(environment.CAPACITY_MAX_RSS_MB || 6656),
    maxOutboxAgeSeconds: Number(
      environment.CAPACITY_MAX_OUTBOX_AGE_SECONDS || 30
    )
  };
};

const requestProbe = async (config, runId) => {
  const url = new URL(
    "/internal/v1/messaging/capacity-probe",
    `${config.targetUrl}/`
  );
  url.searchParams.set("connectionIds", config.connectionIds.join(","));
  url.searchParams.set("runId", runId);
  const startedAt = performance.now();
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.serviceToken}` }
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `Probe HTTP ${response.status}: ${JSON.stringify(payload)}`
    );
  }
  return { latencyMs: performance.now() - startedAt, payload };
};

const run = async config => {
  const latencies = [];
  const failures = [];
  let maxRss = 0;
  let maxOutboxAgeSeconds = 0;
  let maxDatabaseLatencyMs = 0;
  let maxCapacityAgeSeconds = 0;
  let maxObservedLastMinute = 0;
  const runId = crypto.randomUUID();

  for (let second = 0; second < config.durationSeconds; second += 1) {
    const tickStartedAt = performance.now();
    const results = await Promise.allSettled(
      Array.from({ length: config.requestsPerSecond }, () =>
        requestProbe(config, runId)
      )
    );
    results.forEach(result => {
      if (result.status === "rejected") {
        failures.push(String(result.reason));
        return;
      }
      const { latencyMs, payload } = result.value;
      latencies.push(latencyMs);
      maxRss = Math.max(maxRss, Number(payload.metrics?.process?.rss || 0));
      maxOutboxAgeSeconds = Math.max(
        maxOutboxAgeSeconds,
        Number(payload.metrics?.outbox?.oldestPendingSeconds || 0)
      );
      maxDatabaseLatencyMs = Math.max(
        maxDatabaseLatencyMs,
        Number(payload.databaseLatencyMs || 0)
      );
      maxCapacityAgeSeconds = Math.max(
        maxCapacityAgeSeconds,
        Number(payload.metrics?.capacityObservation?.oldestPendingSeconds || 0)
      );
      maxObservedLastMinute = Math.max(
        maxObservedLastMinute,
        Number(payload.metrics?.capacityObservation?.observedLastMinute || 0)
      );
    });
    const remaining = 1000 - (performance.now() - tickStartedAt);
    if (remaining > 0)
      await new Promise(resolve => setTimeout(resolve, remaining));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    runId,
    topology: {
      realConnections: config.connectionIds.length,
      requestsPerSecond: config.requestsPerSecond,
      durationSeconds: config.durationSeconds,
      providerMockUsed: false,
      probeMode: "read-only"
    },
    measurements: {
      requests: latencies.length,
      failures: failures.length,
      p50Ms: percentile(latencies, 0.5),
      p95Ms: percentile(latencies, 0.95),
      p99Ms: percentile(latencies, 0.99),
      maxRssMb: maxRss / 1024 / 1024,
      maxOutboxAgeSeconds,
      maxDatabaseLatencyMs,
      maxCapacityAgeSeconds,
      maxObservedLastMinute
    },
    gates: {
      zeroFailures: failures.length === 0,
      p95: percentile(latencies, 0.95) <= config.maxP95Ms,
      rss: maxRss / 1024 / 1024 <= config.maxRssMb,
      outboxAge: maxOutboxAgeSeconds <= config.maxOutboxAgeSeconds,
      observationBacklog: maxCapacityAgeSeconds <= config.maxOutboxAgeSeconds,
      observerThroughput: maxObservedLastMinute >= config.requestsPerSecond
    },
    failureSamples: failures.slice(0, 20)
  };
  report.passed = Object.values(report.gates).every(Boolean);

  const outputDirectory = path.resolve(__dirname, "../artifacts/capacity");
  fs.mkdirSync(outputDirectory, { recursive: true });
  const outputPath = path.join(
    outputDirectory,
    `messaging-capacity-${Date.now()}.json`
  );
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ outputPath, ...report }, null, 2));
  if (!report.passed) process.exitCode = 1;
  return report;
};

if (require.main === module) {
  try {
    run(loadConfig(process.env)).catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { loadConfig, percentile, requestProbe, run };
