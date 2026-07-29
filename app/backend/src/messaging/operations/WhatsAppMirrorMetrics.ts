type WhatsAppMirrorMetric =
  | "projectionFailure"
  | "cryptoFailure"
  | "mediaAvailable"
  | "mediaUnavailable"
  | "mediaFailure"
  | "purgedBody";

const counters = {
  projectionFailures: 0,
  cryptoFailures: 0,
  mediaAvailable: 0,
  mediaUnavailable: 0,
  mediaFailures: 0,
  purgedBodies: 0
};

export const recordWhatsAppMirrorMetric = (
  metric: WhatsAppMirrorMetric,
  amount = 1
): void => {
  const safeAmount = Number.isSafeInteger(amount) && amount > 0 ? amount : 1;
  if (metric === "projectionFailure") counters.projectionFailures += safeAmount;
  if (metric === "cryptoFailure") counters.cryptoFailures += safeAmount;
  if (metric === "mediaAvailable") counters.mediaAvailable += safeAmount;
  if (metric === "mediaUnavailable") counters.mediaUnavailable += safeAmount;
  if (metric === "mediaFailure") counters.mediaFailures += safeAmount;
  if (metric === "purgedBody") counters.purgedBodies += safeAmount;
};

export const snapshotWhatsAppMirrorMetrics = (): Record<string, unknown> => ({
  projectionFailures: counters.projectionFailures,
  cryptoFailures: counters.cryptoFailures,
  media: {
    available: counters.mediaAvailable,
    unavailable: counters.mediaUnavailable,
    failures: counters.mediaFailures
  },
  purge: { encryptedBodies: counters.purgedBodies }
});

export const resetWhatsAppMirrorMetricsForTests = (): void => {
  Object.keys(counters).forEach(key => {
    counters[key as keyof typeof counters] = 0;
  });
};
