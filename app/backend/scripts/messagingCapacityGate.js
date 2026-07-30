const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const REPLAY_RATE = 150;
const REPLAY_DURATION_SECONDS = 1800;
const REPLAY_DRAIN_DEADLINE_SECONDS = 900;
const REPLAY_EXPECTED_EVENTS = REPLAY_RATE * REPLAY_DURATION_SECONDS;
const REQUEST_TIMEOUT_MS = 10_000;
const REPLAY_FIXTURE_DIRECTORY = path.resolve(
  __dirname,
  "../fixtures/whatsapp-mirror"
);
const REPLAY_FIXTURE_FILES = ["baileys-rich.json", "meta-rich.json"];
const FORBIDDEN_FIXTURE_KEYS =
  /(?:authorization|cookie|password|secret|token|phoneNumber|url)/i;
const WHATSAPP_FIXTURE_ID =
  /^(?:0{12,18}(?:-0{10})?)@(?:s\.whatsapp\.net|g\.us|lid|c\.us)$/i;

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

const validateReplayFixture = fixture => {
  const visit = (value, location) => {
    if (typeof value === "string") {
      if (/bearer\s+/i.test(value)) {
        throw new Error(`Fixture insegura em ${location}`);
      }
      if (
        /@(?:s\.whatsapp\.net|g\.us|lid|c\.us)$/i.test(value) &&
        !WHATSAPP_FIXTURE_ID.test(value)
      ) {
        throw new Error(`Fixture exige JID/LID sintetico em ${location}`);
      }
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${location}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") return;
    Object.entries(value).forEach(([key, item]) => {
      if (FORBIDDEN_FIXTURE_KEYS.test(key)) {
        throw new Error(`Fixture insegura: campo ${key} nao e permitido`);
      }
      visit(item, `${location}.${key}`);
    });
  };

  if (!fixture || typeof fixture !== "object" || Array.isArray(fixture)) {
    throw new Error("Fixture de replay deve ser um objeto");
  }
  if (!/^[a-z0-9-]+$/.test(String(fixture.name || ""))) {
    throw new Error("Fixture de replay exige nome sintetico");
  }
  if (!["baileys", "meta_cloud"].includes(fixture.provider)) {
    throw new Error("Fixture de replay exige provider conhecido");
  }
  if (!Array.isArray(fixture.events) || fixture.events.length === 0) {
    throw new Error("Fixture de replay exige eventos");
  }
  visit(fixture, "$");
  return fixture;
};

const loadReplayFixtures = (
  directory = REPLAY_FIXTURE_DIRECTORY,
  files = REPLAY_FIXTURE_FILES
) =>
  files.map(fileName =>
    validateReplayFixture(
      JSON.parse(fs.readFileSync(path.join(directory, fileName), "utf8"))
    )
  );

const selectReplayInput = (fixtures, sequence) => {
  const cycle = fixtures.flatMap(fixture =>
    fixture.events.map(event => ({ fixture, event }))
  );
  if (!cycle.length) throw new Error("Replay cycle requires fixture inputs");
  return cycle[sequence % cycle.length];
};

const requireHttpsUrl = (value, name) => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_error) {
    throw new Error(`${name} deve ser uma URL HTTPS valida`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${name} deve usar HTTPS`);
  }
  return value.replace(/\/$/, "");
};

const loadReplayConfig = environment => {
  const common = {
    mode: "dry-validation",
    requestsPerSecond: REPLAY_RATE,
    durationSeconds: REPLAY_DURATION_SECONDS,
    drainDeadlineSeconds: REPLAY_DRAIN_DEADLINE_SECONDS,
    expectedEvents: REPLAY_EXPECTED_EVENTS,
    fixtureDirectory: REPLAY_FIXTURE_DIRECTORY
  };
  if (environment.MESSAGING_WEBHOOK_REPLAY_RUN !== "STAGING_ONLY") {
    return common;
  }
  if (environment.CAPACITY_ENVIRONMENT !== "staging") {
    throw new Error(
      "Replay live bloqueado: defina CAPACITY_ENVIRONMENT=staging."
    );
  }
  const requestsPerSecond = Number(environment.CAPACITY_RPS || REPLAY_RATE);
  const durationSeconds = Number(
    environment.CAPACITY_DURATION_SECONDS || REPLAY_DURATION_SECONDS
  );
  const drainDeadlineSeconds = Number(
    environment.CAPACITY_DRAIN_DEADLINE_SECONDS || REPLAY_DRAIN_DEADLINE_SECONDS
  );
  if (
    requestsPerSecond !== REPLAY_RATE ||
    durationSeconds !== REPLAY_DURATION_SECONDS ||
    drainDeadlineSeconds !== REPLAY_DRAIN_DEADLINE_SECONDS
  ) {
    throw new Error(
      "O gate exige exatamente 150 eventos/s por 1800 s e drain em 900 s."
    );
  }
  if (
    !environment.CAPACITY_TARGET_URL ||
    !environment.CAPACITY_SERVICE_TOKEN ||
    !environment.CAPACITY_RECEIVER_METRICS_URL
  ) {
    throw new Error(
      "CAPACITY_TARGET_URL, CAPACITY_SERVICE_TOKEN e CAPACITY_RECEIVER_METRICS_URL sao obrigatorios."
    );
  }
  const whatsappId = Number(environment.CAPACITY_REPLAY_WHATSAPP_ID);
  if (!Number.isSafeInteger(whatsappId) || whatsappId < 1) {
    throw new Error("CAPACITY_REPLAY_WHATSAPP_ID deve ser um ID de staging.");
  }
  return {
    ...common,
    mode: "staging-replay",
    targetUrl: requireHttpsUrl(
      environment.CAPACITY_TARGET_URL,
      "CAPACITY_TARGET_URL"
    ),
    serviceToken: environment.CAPACITY_SERVICE_TOKEN,
    receiverMetricsUrl: requireHttpsUrl(
      environment.CAPACITY_RECEIVER_METRICS_URL,
      "CAPACITY_RECEIVER_METRICS_URL"
    ),
    receiverStatusToken: environment.CAPACITY_RECEIVER_STATUS_TOKEN,
    whatsappId
  };
};

const buildReplayReport = (config, measurements) => {
  const receiver = measurements.receiver || {};
  const pipeline = measurements.pipeline || {};
  const received = Number(receiver.received || 0);
  const expectedDuplicates = Number(receiver.expectedDuplicates || 0);
  const unexpectedDuplicates = Number(receiver.unexpectedDuplicates || 0);
  const signatureFailures = Number(receiver.signatureFailures || 0);
  const plaintextViolations = Number(receiver.plaintextViolations || 0);
  const gates = {
    zeroLoss:
      measurements.accepted === config.expectedEvents &&
      received - expectedDuplicates === config.expectedEvents,
    zeroUnexpectedDuplicates: unexpectedDuplicates === 0,
    zeroPlaintext: plaintextViolations === 0,
    hmacVerified: signatureFailures === 0 && received > 0,
    drainedWithinDeadline:
      Number(measurements.drainSeconds) <= config.drainDeadlineSeconds,
    sustainedInjectionRate:
      Number(measurements.offeredEvents) === config.expectedEvents &&
      Number(measurements.injectionElapsedSeconds) >=
        config.durationSeconds * 0.995 &&
      Number(measurements.injectionElapsedSeconds) <=
        config.durationSeconds * 1.005 &&
      Number(measurements.offeredRps) >= config.requestsPerSecond * 0.995,
    pipelineHealthy:
      Number(pipeline.durableProjectionFailures || 0) === 0 &&
      Number(pipeline.durableCryptoFailures || 0) === 0 &&
      Number(pipeline.deadLettersDelta || 0) === 0
  };
  return {
    generatedAt: new Date().toISOString(),
    mode: "staging-replay",
    topology: {
      providerSendUsed: false,
      realPostgresRequired: true,
      projectionRequired: true,
      encryptedFanoutRequired: true,
      hmacReceiverRequired: true,
      n8nReceiverRequired: true,
      requestsPerSecond: REPLAY_RATE,
      durationSeconds: REPLAY_DURATION_SECONDS,
      expectedEvents: config.expectedEvents,
      drainDeadlineSeconds: config.drainDeadlineSeconds
    },
    measurements: {
      accepted: Number(measurements.accepted || 0),
      receiver: {
        received,
        expectedDuplicates,
        unexpectedDuplicates,
        signatureFailures,
        plaintextViolations
      },
      pipeline: {
        durableProjectionFailures: Number(
          pipeline.durableProjectionFailures || 0
        ),
        durableCryptoFailures: Number(pipeline.durableCryptoFailures || 0),
        deadLettersDelta: Number(pipeline.deadLettersDelta || 0),
        backlog: pipeline.backlog || null,
        throughput: pipeline.throughput || null,
        purge: pipeline.purge || null,
        media: pipeline.media || null
      },
      offeredEvents: Number(measurements.offeredEvents),
      injectionElapsedSeconds: Number(measurements.injectionElapsedSeconds),
      offeredRps: Number(measurements.offeredRps),
      completionElapsedSeconds: Number(measurements.completionElapsedSeconds),
      drainSeconds: Number(measurements.drainSeconds)
    },
    gates,
    passed: Object.values(gates).every(Boolean)
  };
};

const writeReport = (prefix, report) => {
  const outputDirectory = path.resolve(__dirname, "../artifacts/capacity");
  fs.mkdirSync(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, `${prefix}-${Date.now()}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  return outputPath;
};

const fetchJsonWithTimeout = async (
  url,
  options = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
  fetchImplementation = fetch
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImplementation(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      throw new Error(`request timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(`HTTP_${response.status}`);
  }
  return response.json();
};
const requestJson = (url, options) =>
  fetchJsonWithTimeout(url, options, REQUEST_TIMEOUT_MS);

const buildInjectionMeasurements = (offered, startedAt, finishedAt) => {
  const injectionElapsedSeconds = Math.max(0, (finishedAt - startedAt) / 1000);
  return {
    offeredEvents: offered,
    injectionElapsedSeconds,
    offeredRps:
      injectionElapsedSeconds > 0 ? offered / injectionElapsedSeconds : 0
  };
};

const scheduleOfferedLoad = async ({
  durationSeconds,
  requestsPerSecond,
  offer,
  now = () => performance.now(),
  sleep = milliseconds =>
    new Promise(resolve => setTimeout(resolve, milliseconds))
}) => {
  const startedAt = now();
  let offered = 0;
  let accepted = 0;
  const pending = new Set();
  for (let second = 0; second < durationSeconds; second += 1) {
    for (let index = 0; index < requestsPerSecond; index += 1) {
      const sequence = second * requestsPerSecond + index;
      offered += 1;
      const request = Promise.resolve()
        .then(() => offer(sequence))
        .then(() => {
          accepted += 1;
        })
        .catch(() => undefined)
        .finally(() => pending.delete(request));
      pending.add(request);
    }
    const remaining = startedAt + (second + 1) * 1000 - now();
    if (remaining > 0) await sleep(remaining);
  }
  const offeredFinishedAt = now();
  await Promise.all([...pending]);
  return {
    accepted,
    ...buildInjectionMeasurements(offered, startedAt, offeredFinishedAt),
    completionElapsedSeconds: Math.max(0, (now() - startedAt) / 1000)
  };
};

const replayOne = (config, runId, runStartedAt, sequence, fixture, event) =>
  requestJson(
    new URL("/internal/v1/messaging/capacity-replay", `${config.targetUrl}/`),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.serviceToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        runId,
        runStartedAt,
        sequence,
        whatsappId: config.whatsappId,
        fixture: {
          name: fixture.name,
          provider: fixture.provider,
          event
        }
      })
    }
  );

const readReceiverMetrics = (config, runId) => {
  const url = new URL(config.receiverMetricsUrl);
  url.searchParams.set("runId", runId);
  return requestJson(url, {
    headers: config.receiverStatusToken
      ? { Authorization: `Bearer ${config.receiverStatusToken}` }
      : {}
  });
};

const readDiaChatMetrics = config =>
  requestJson(
    new URL("/internal/v1/messaging/metrics", `${config.targetUrl}/`),
    { headers: { Authorization: `Bearer ${config.serviceToken}` } }
  );

const replayFixtures = async config => {
  const fixtures = loadReplayFixtures(config.fixtureDirectory);
  if (config.mode === "dry-validation") {
    const report = {
      generatedAt: new Date().toISOString(),
      mode: "dry-validation",
      liveGate: "not-run",
      fixtures: fixtures.map(fixture => ({
        name: fixture.name,
        provider: fixture.provider,
        adapterInputs: fixture.events.length
      })),
      externalContractGate: {
        status: "blocked",
        reason:
          "Current Roteador parser rejects real whatsapp-mirror/1 envelopes; run verify:roteador-contract."
      },
      target: {
        requestsPerSecond: REPLAY_RATE,
        durationSeconds: REPLAY_DURATION_SECONDS,
        expectedEvents: REPLAY_EXPECTED_EVENTS,
        drainDeadlineSeconds: REPLAY_DRAIN_DEADLINE_SECONDS
      },
      fixtureValidationPassed: true,
      activationBlocked: true
    };
    const outputPath = writeReport("whatsapp-mirror-dry-validation", report);
    console.log(JSON.stringify({ outputPath, ...report }, null, 2));
    return report;
  }

  const contractVerification = spawnSync(
    process.execPath,
    [path.resolve(__dirname, "verifyRoteadorContractFixtures.js")],
    { encoding: "utf8" }
  );
  if (contractVerification.status !== 0) {
    throw new Error(
      `Replay live bloqueado pelo contrato externo do Roteador: ${
        contractVerification.stdout ||
        contractVerification.stderr ||
        "incompatível"
      }`
    );
  }

  const runId = crypto.randomUUID();
  const runStartedAt = new Date().toISOString();
  const initialMetrics = await readDiaChatMetrics(config);
  const injection = await scheduleOfferedLoad({
    durationSeconds: config.durationSeconds,
    requestsPerSecond: config.requestsPerSecond,
    offer: sequence => {
      const { fixture, event } = selectReplayInput(fixtures, sequence);
      return replayOne(config, runId, runStartedAt, sequence, fixture, event);
    }
  });
  const { accepted } = injection;

  const drainStartedAt = performance.now();
  let diaChatMetrics;
  let receiver;
  while (
    (performance.now() - drainStartedAt) / 1000 <=
    config.drainDeadlineSeconds
  ) {
    [diaChatMetrics, receiver] = await Promise.all([
      readDiaChatMetrics(config),
      readReceiverMetrics(config, runId)
    ]);
    const pending =
      Number(diaChatMetrics.outbox?.ready || 0) +
      Number(diaChatMetrics.outbox?.inFlight || 0) +
      Number(diaChatMetrics.webhooks?.ready || 0) +
      Number(diaChatMetrics.webhooks?.inFlight || 0);
    if (pending === 0 && Number(receiver.received || 0) >= accepted) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const report = buildReplayReport(config, {
    accepted,
    receiver,
    pipeline: {
      durableProjectionFailures:
        Number(diaChatMetrics?.mirror?.durableFailures?.projection || 0) -
        Number(initialMetrics.mirror?.durableFailures?.projection || 0),
      durableCryptoFailures:
        Number(diaChatMetrics?.mirror?.durableFailures?.crypto || 0) -
        Number(initialMetrics.mirror?.durableFailures?.crypto || 0),
      deadLettersDelta:
        Number(diaChatMetrics?.commands?.deadLetter || 0) +
        Number(diaChatMetrics?.outbox?.deadLetter || 0) +
        Number(diaChatMetrics?.inbox?.deadLetter || 0) +
        Number(diaChatMetrics?.webhooks?.deadLetter || 0) -
        Number(initialMetrics.commands?.deadLetter || 0) -
        Number(initialMetrics.outbox?.deadLetter || 0) -
        Number(initialMetrics.inbox?.deadLetter || 0) -
        Number(initialMetrics.webhooks?.deadLetter || 0),
      backlog: {
        outbox: {
          ready: Number(diaChatMetrics?.outbox?.ready || 0),
          inFlight: Number(diaChatMetrics?.outbox?.inFlight || 0),
          oldestSeconds: Number(
            diaChatMetrics?.outbox?.oldestPendingSeconds || 0
          )
        },
        webhooks: {
          ready: Number(diaChatMetrics?.webhooks?.ready || 0),
          inFlight: Number(diaChatMetrics?.webhooks?.inFlight || 0),
          oldestSeconds: Number(
            diaChatMetrics?.webhooks?.oldestPendingSeconds || 0
          )
        }
      },
      throughput: diaChatMetrics?.mirror?.throughput || null,
      purge: diaChatMetrics?.mirror?.purge || null,
      media: diaChatMetrics?.mirror?.media || null
    },
    ...injection,
    drainSeconds: Math.ceil((performance.now() - drainStartedAt) / 1000)
  });
  const outputPath = writeReport("whatsapp-mirror-capacity", report);
  console.log(JSON.stringify({ outputPath, ...report }, null, 2));
  if (!report.passed) process.exitCode = 1;
  return report;
};

const requestProbe = async (config, runId) => {
  const url = new URL(
    "/internal/v1/messaging/capacity-probe",
    `${config.targetUrl}/`
  );
  url.searchParams.set("connectionIds", config.connectionIds.join(","));
  url.searchParams.set("runId", runId);
  const startedAt = performance.now();
  const payload = await requestJson(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.serviceToken}` }
  });
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

  const outputPath = writeReport("messaging-capacity", report);
  console.log(JSON.stringify({ outputPath, ...report }, null, 2));
  if (!report.passed) process.exitCode = 1;
  return report;
};

if (require.main === module) {
  try {
    const command =
      process.argv.includes("--whatsapp-mirror") ||
      process.env.CAPACITY_MODE === "whatsapp-mirror"
        ? replayFixtures(loadReplayConfig(process.env))
        : run(loadConfig(process.env));
    command.catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  buildInjectionMeasurements,
  buildReplayReport,
  fetchJsonWithTimeout,
  loadConfig,
  loadReplayConfig,
  loadReplayFixtures,
  percentile,
  replayFixtures,
  scheduleOfferedLoad,
  requestProbe,
  run,
  selectReplayInput,
  validateReplayFixture
};
