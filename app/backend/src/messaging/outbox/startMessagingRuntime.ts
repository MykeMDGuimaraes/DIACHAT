import { logger } from "../../utils/logger";
import { createMessagingRuntime } from "./MessagingRuntime";

export const startMessagingRuntime = (): (() => void) => {
  const runtime = createMessagingRuntime();
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
  const interval = setInterval(() => void run(), 5_000);

  return () => clearInterval(interval);
};
