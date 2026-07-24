import BaileysMessageCommandProvider from "../adapters/baileys/BaileysMessageCommandProvider";
import MetaCloudMessageCommandProvider from "../adapters/meta-cloud/MetaCloudMessageCommandProvider";
import MetaInboxProcessor from "../channels/meta-cloud/MetaInboxProcessor";
import WebhookDeliveryDispatcher from "../webhooks/WebhookDeliveryDispatcher";
import WebhookFanoutService from "../webhooks/WebhookFanoutService";
import WebhookRecoveryService from "../webhooks/WebhookRecoveryService";
import MessageCommandRecoveryService from "../application/MessageCommandRecoveryService";
import MessageCommandDispatcher from "./MessageCommandDispatcher";
import MessagingOutboxRecoveryService from "./MessagingOutboxRecoveryService";

interface RecoveryRunner {
  recover: () => Promise<{ recovered: number }>;
}

interface DispatchRunner {
  dispatchOne: () => Promise<{ status: "idle" | "sent" | "unknown" }>;
}

interface InboxRunner {
  processOne: () => Promise<{ status: "idle" | "processed" | "retry" }>;
}

interface WebhookFanoutRunner {
  fanoutOne: () => Promise<{ status: "idle" | "created"; deliveries: number }>;
}

interface WebhookDispatchRunner {
  dispatchOne: () => Promise<{ status: "idle" | "delivered" | "retry" | "dead_letter" }>;
}

class MessagingRuntime {
  constructor(
    private readonly recovery: RecoveryRunner,
    private readonly dispatcher: DispatchRunner,
    private readonly batchSize = 25,
    private readonly inbox: InboxRunner = { processOne: async () => ({ status: "idle" }) },
    private readonly webhookFanout: WebhookFanoutRunner = { fanoutOne: async () => ({ status: "idle", deliveries: 0 }) },
    private readonly webhookDispatcher: WebhookDispatchRunner = { dispatchOne: async () => ({ status: "idle" }) }
  ) {}

  async runOnce(): Promise<{ recovered: number; dispatched: number; processedInbox: number; webhookDeliveriesCreated: number; webhooksDispatched: number }> {
    const { recovered } = await this.recovery.recover();
    let dispatched = 0;
    let processedInbox = 0;
    let webhookDeliveriesCreated = 0;
    let webhooksDispatched = 0;

    for (let index = 0; index < this.batchSize; index += 1) {
      const result = await this.inbox.processOne();
      if (result.status !== "processed") break;
      processedInbox += 1;
    }

    for (let index = 0; index < this.batchSize; index += 1) {
      const result = await this.dispatcher.dispatchOne();
      if (result.status === "idle") {
        break;
      }
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

    return { recovered, dispatched, processedInbox, webhookDeliveriesCreated, webhooksDispatched };
  }
}

export const createMessagingRuntime = (): MessagingRuntime =>
  new MessagingRuntime(
    {
      recover: async () => {
        const commands = await new MessageCommandRecoveryService().recover();
        const events = await new MessagingOutboxRecoveryService().recover();
        const webhooks = await new WebhookRecoveryService().recover();
        return {
          recovered:
            commands.recovered +
            events.completed +
            events.requeued +
            webhooks.deliveries +
            webhooks.events
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
    new WebhookDeliveryDispatcher()
  );

export default MessagingRuntime;
