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
    }
  ) {}

  async runOnce(): Promise<{
    recovered: number;
    dispatched: number;
    processedInbox: number;
    webhookDeliveriesCreated: number;
    webhooksDispatched: number;
    capacitySamplesObserved: number;
  }> {
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

    for (let index = 0; index < this.batchSize; index += 1) {
      const result = await this.webhookFanout.fanoutOne();
      if (result.status === "idle") break;
      webhookDeliveriesCreated += result.deliveries;
    }

    for (let index = 0; index < this.batchSize; index += 1) {
      const result = await this.webhookDispatcher.dispatchOne();
      if (result.status === "idle") break;
      webhooksDispatched += 1;
    }

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
    new ConversationCommandDispatcher()
  );

export default MessagingRuntime;
