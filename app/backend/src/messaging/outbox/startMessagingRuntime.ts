import { logger } from "../../utils/logger";
import { createMessagingRuntime } from "./MessagingRuntime";
import MessagingRetentionService, {
  recordRetentionFailure
} from "../operations/MessagingRetentionService";

export const startMessagingRuntime = (): (() => void) => {
  const runtime = createMessagingRuntime();
  const retention = new MessagingRetentionService();
  let running = false;

  const run = async (): Promise<void> => {
    if (running) {
      return;
    }

    running = true;
    try {
      await runtime.runOnce();
    } catch (error) {
      logger.error(error);
    } finally {
      running = false;
    }
  };

  void run();
  const purge = async (): Promise<void> => {
    try {
      await retention.purge();
    } catch (error) {
      recordRetentionFailure(error);
      logger.error(error);
    }
  };
  void purge();
  const interval = setInterval(
    () => void run(),
    process.env.MESSAGING_CAPACITY_PROBE_ENABLED === "true" ? 500 : 5_000
  );
  const retentionInterval = setInterval(
    () => void purge(),
    6 * 60 * 60 * 1000
  );

  return () => {
    clearInterval(interval);
    clearInterval(retentionInterval);
  };
};
