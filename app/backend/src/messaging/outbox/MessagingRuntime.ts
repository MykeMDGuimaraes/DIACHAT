import BaileysMessageCommandProvider from "../adapters/baileys/BaileysMessageCommandProvider";
import MetaCloudMessageCommandProvider from "../adapters/meta-cloud/MetaCloudMessageCommandProvider";
import MessageCommandRecoveryService from "../application/MessageCommandRecoveryService";
import MessageCommandDispatcher from "./MessageCommandDispatcher";
import MessagingOutboxRecoveryService from "./MessagingOutboxRecoveryService";

interface RecoveryRunner {
  recover: () => Promise<{ recovered: number }>;
}

interface DispatchRunner {
  dispatchOne: () => Promise<{ status: "idle" | "sent" | "unknown" }>;
}

class MessagingRuntime {
  constructor(
    private readonly recovery: RecoveryRunner,
    private readonly dispatcher: DispatchRunner,
    private readonly batchSize = 25
  ) {}

  async runOnce(): Promise<{ recovered: number; dispatched: number }> {
    const { recovered } = await this.recovery.recover();
    let dispatched = 0;

    for (let index = 0; index < this.batchSize; index += 1) {
      const result = await this.dispatcher.dispatchOne();
      if (result.status === "idle") {
        break;
      }
      dispatched += 1;
    }

    return { recovered, dispatched };
  }
}

export const createMessagingRuntime = (): MessagingRuntime =>
  new MessagingRuntime(
    {
      recover: async () => {
        const commands = await new MessageCommandRecoveryService().recover();
        const events = await new MessagingOutboxRecoveryService().recover();
        return {
          recovered: commands.recovered + events.completed + events.requeued
        };
      }
    },
    new MessageCommandDispatcher(undefined, [
      new BaileysMessageCommandProvider(),
      new MetaCloudMessageCommandProvider()
    ])
  );

export default MessagingRuntime;
