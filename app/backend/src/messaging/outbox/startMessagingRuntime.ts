import { logger } from "../../utils/logger";
import { createMessagingRuntime } from "./MessagingRuntime";
import MessagingRetentionService, {
  recordRetentionFailure
} from "../operations/MessagingRetentionService";

export interface MessagingRuntimeOptions {
  // Callback injetado pelo núcleo (server.ts) para notificar mudanças de
  // saúde de entrega dos canais — o módulo de mensageria não emite socket.
  onChannelHealthChanged?: (channel: any) => void;
}

export const startMessagingRuntime = (
  options: MessagingRuntimeOptions = {}
): (() => void) => {
  const runtime = createMessagingRuntime();
  const retention = new MessagingRetentionService();
  let running = false;

  const run = async (): Promise<void> => {
    if (running) {
      return;
    }

    running = true;
    try {
      const result = await runtime.runOnce();
      if (options.onChannelHealthChanged) {
        for (const channel of result.healthChangedChannels) {
          try {
            options.onChannelHealthChanged(channel);
          } catch (error) {
            logger.error(error);
          }
        }
      }
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
