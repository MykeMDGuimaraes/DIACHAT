import BaileysMessageCommandProvider from "../adapters/baileys/BaileysMessageCommandProvider";
import MetaCloudMessageCommandProvider from "../adapters/meta-cloud/MetaCloudMessageCommandProvider";
import MetaInboxProcessor from "../channels/meta-cloud/MetaInboxProcessor";
import WebhookDeliveryDispatcher from "../webhooks/WebhookDeliveryDispatcher";
import WebhookFanoutService from "../webhooks/WebhookFanoutService";
import WebhookRecoveryService from "../webhooks/WebhookRecoveryService";
import MessageCommandDispatcher from "./MessageCommandDispatcher";
import OutboundPairRecoveryService from "./OutboundPairRecoveryService";
import MessagingCapacityObserver from "../operations/MessagingCapacityObserver";
import MetaInboxRecoveryService from "../channels/meta-cloud/MetaInboxRecoveryService";
import ConversationCommandDispatcher from "./ConversationCommandDispatcher";
import ConversationCommandRecoveryService from "./ConversationCommandRecoveryService";
import WebhookDeliveryBackfillService from "../webhooks/WebhookDeliveryBackfillService";
import { logger } from "../../utils/logger";

interface RecoveryRunner {
  recover: () => Promise<{ recovered: number }>;
}

interface DispatchRunner {
  dispatchOne: () => Promise<{ status: string }>;
}

interface InboxRunner {
  processOne: () => Promise<{
    status: "idle" | "processed" | "retry" | "dead_letter";
  }>;
}

interface WebhookFanoutRunner {
  fanoutOne: () => Promise<{ status: "idle" | "created"; deliveries: number }>;
}

interface WebhookDispatchRunner {
  dispatchOne: () => Promise<{
    status: "idle" | "delivered" | "retry" | "dead_letter";
  }>;
}

interface CapacityObserverRunner {
  observeOne: () => Promise<{ status: "idle" | "observed" }>;
}

interface WebhookBackfillRunner {
  runBatch: () => Promise<{
    processed: number;
    safeToDispatch: boolean;
  }>;
}

export interface WebhookRuntimeConcurrency {
  fanout: number;
  delivery: number;
}

type WebhookPoolName = "fanout" | "delivery";

const MAX_WEBHOOK_RUNTIME_CONCURRENCY = 128;
const MAX_ADAPTIVE_WEBHOOK_ROUNDS = 8;

const boundedConcurrency = (
  value: string | undefined,
  fallback: number
): number => {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(MAX_WEBHOOK_RUNTIME_CONCURRENCY, parsed);
};

export const resolveWebhookRuntimeConcurrency = (
  environment: Record<string, string | undefined> = process.env
): WebhookRuntimeConcurrency => ({
  fanout: boundedConcurrency(
    environment.MESSAGING_WEBHOOK_FANOUT_CONCURRENCY,
    8
  ),
  delivery: boundedConcurrency(
    environment.MESSAGING_WEBHOOK_DELIVERY_CONCURRENCY,
    environment.NODE_ENV === "staging" ? 64 : 32
  )
});

class MessagingRuntime {
  // Parameter properties keep each worker replaceable in tests.
  // eslint-disable-next-line no-useless-constructor
  constructor(
    private readonly recovery: RecoveryRunner,
    private readonly dispatcher: DispatchRunner,
    private readonly batchSize = 25,
    private readonly inbox: InboxRunner = {
      processOne: async () => ({ status: "idle" })
    },
    private readonly webhookFanout: WebhookFanoutRunner = {
      fanoutOne: async () => ({ status: "idle", deliveries: 0 })
    },
    private readonly webhookDispatcher: WebhookDispatchRunner = {
      dispatchOne: async () => ({ status: "idle" })
    },
    private readonly capacityObserver: CapacityObserverRunner = {
      observeOne: async () => ({ status: "idle" })
    },
    private readonly conversationDispatcher: DispatchRunner = {
      dispatchOne: async () => ({ status: "idle" })
    },
    private readonly webhookBackfill: WebhookBackfillRunner = {
      runBatch: async () => ({ processed: 0, safeToDispatch: true })
    },
    private readonly webhookConcurrency: WebhookRuntimeConcurrency = resolveWebhookRuntimeConcurrency(),
    private readonly reportWebhookPoolFailure: (
      pool: WebhookPoolName,
      failedLanes: number
    ) => void = (pool, failedLanes) =>
      logger.error(
        { webhookPool: pool, failedLanes },
        "Messaging webhook pool lanes failed"
      )
  ) {}

  private async drainWebhookFanout(): Promise<number> {
    let totalDeliveries = 0;
    for (let round = 0; round < MAX_ADAPTIVE_WEBHOOK_ROUNDS; round += 1) {
      const lanes = Array.from(
        { length: this.webhookConcurrency.fanout },
        async () => {
          let deliveries = 0;
          let processed = 0;
          for (let index = 0; index < this.batchSize; index += 1) {
            const result = await this.webhookFanout.fanoutOne();
            if (result.status === "idle") break;
            processed += 1;
            deliveries += result.deliveries;
          }
          return { deliveries, saturated: processed === this.batchSize };
        }
      );
      const settled = await Promise.allSettled(lanes);
      const failedLanes = settled.filter(
        result => result.status === "rejected"
      ).length;
      if (failedLanes) {
        this.reportWebhookPoolFailure("fanout", failedLanes);
      }
      totalDeliveries += settled.reduce(
        (total, result) =>
          total + (result.status === "fulfilled" ? result.value.deliveries : 0),
        0
      );
      const saturated =
        failedLanes === 0 &&
        settled.every(
          result => result.status === "fulfilled" && result.value.saturated
        );
      if (!saturated) break;
    }
    return totalDeliveries;
  }

  private async drainWebhookDelivery(): Promise<number> {
    let totalDispatched = 0;
    for (let round = 0; round < MAX_ADAPTIVE_WEBHOOK_ROUNDS; round += 1) {
      const lanes = Array.from(
        { length: this.webhookConcurrency.delivery },
        async () => {
          let dispatched = 0;
          let processed = 0;
          for (let index = 0; index < this.batchSize; index += 1) {
            const result = await this.webhookDispatcher.dispatchOne();
            if (result.status === "idle") break;
            processed += 1;
            dispatched += 1;
          }
          return { dispatched, saturated: processed === this.batchSize };
        }
      );
      const settled = await Promise.allSettled(lanes);
      const failedLanes = settled.filter(
        result => result.status === "rejected"
      ).length;
      if (failedLanes) {
        this.reportWebhookPoolFailure("delivery", failedLanes);
      }
      totalDispatched += settled.reduce(
        (total, result) =>
          total + (result.status === "fulfilled" ? result.value.dispatched : 0),
        0
      );
      const saturated =
        failedLanes === 0 &&
        settled.every(
          result => result.status === "fulfilled" && result.value.saturated
        );
      if (!saturated) break;
    }
    return totalDispatched;
  }

  async runOnce(): Promise<{
    recovered: number;
    dispatched: number;
    processedInbox: number;
    webhookDeliveriesCreated: number;
    webhooksDispatched: number;
    capacitySamplesObserved: number;
  }> {
    const startup = await this.webhookBackfill.runBatch();
    if (!startup.safeToDispatch) {
      return {
        recovered: 0,
        dispatched: 0,
        processedInbox: 0,
        webhookDeliveriesCreated: 0,
        webhooksDispatched: 0,
        capacitySamplesObserved: 0
      };
    }
    const { recovered } = await this.recovery.recover();
    let dispatched = 0;
    let processedInbox = 0;
    let webhookDeliveriesCreated = 0;
    let webhooksDispatched = 0;
    let capacitySamplesObserved = 0;

    for (let index = 0; index < this.batchSize; index += 1) {
      const result = await this.capacityObserver.observeOne();
      if (result.status === "idle") break;
      capacitySamplesObserved += 1;
    }

    for (let index = 0; index < this.batchSize; index += 1) {
      const result = await this.inbox.processOne();
      if (result.status === "idle") break;
      if (result.status === "processed") processedInbox += 1;
    }

    for (let index = 0; index < this.batchSize; index += 1) {
      const result = await this.dispatcher.dispatchOne();
      if (result.status === "idle") {
        break;
      }
      dispatched += 1;
    }

    for (let index = 0; index < this.batchSize; index += 1) {
      const result = await this.conversationDispatcher.dispatchOne();
      if (result.status === "idle") break;
      dispatched += 1;
    }

    webhookDeliveriesCreated = await this.drainWebhookFanout();
    webhooksDispatched = await this.drainWebhookDelivery();

    return {
      recovered,
      dispatched,
      processedInbox,
      webhookDeliveriesCreated,
      webhooksDispatched,
      capacitySamplesObserved
    };
  }
}

export const createMessagingRuntime = (): MessagingRuntime =>
  new MessagingRuntime(
    {
      recover: async () => {
        const outbound = await new OutboundPairRecoveryService().recover();
        const webhooks = await new WebhookRecoveryService().recover();
        const inbox = await new MetaInboxRecoveryService().recover();
        const conversations =
          await new ConversationCommandRecoveryService().recover();
        return {
          recovered:
            outbound.recovered +
            webhooks.deliveries +
            webhooks.events +
            inbox.recovered +
            conversations.recovered
        };
      }
    },
    new MessageCommandDispatcher(undefined, [
      new BaileysMessageCommandProvider(),
      new MetaCloudMessageCommandProvider()
    ]),
    25,
    new MetaInboxProcessor(),
    new WebhookFanoutService(),
    new WebhookDeliveryDispatcher(),
    new MessagingCapacityObserver(),
    new ConversationCommandDispatcher(),
    new WebhookDeliveryBackfillService(),
    resolveWebhookRuntimeConcurrency()
  );

export default MessagingRuntime;
