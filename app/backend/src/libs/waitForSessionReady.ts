import AppError from "../errors/AppError";

export const DEFAULT_RECONNECT_WAIT_MS = 45000;
export const RECONNECT_POLL_INTERVAL_MS = 1500;

/**
 * Polls `findReadySession` until it returns a value or `timeoutMs` elapses.
 * Used to hold outbound sends while a WhatsApp socket reconnects (e.g. after
 * a Baileys stream error 515) instead of failing immediately.
 *
 * Throws ERR_WAPP_NOT_AVAILABLE (503) when the window expires.
 */
const waitForSessionReady = async <T>(
  findReadySession: () => T | undefined,
  timeoutMs = DEFAULT_RECONNECT_WAIT_MS,
  pollIntervalMs = RECONNECT_POLL_INTERVAL_MS
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const ready = findReadySession();
    if (ready !== undefined) return ready;

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new AppError("ERR_WAPP_NOT_AVAILABLE", 503);
    }

    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => {
      setTimeout(resolve, Math.min(pollIntervalMs, remaining));
    });
  }
};

export default waitForSessionReady;
