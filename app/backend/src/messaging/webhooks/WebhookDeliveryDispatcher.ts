import { promises as dns } from "dns";
import https from "https";
import { Op } from "sequelize";

import sequelize from "../../database";
import { WEBHOOK_DELIVERY_STATUS } from "../domain/MessagingStates";
import WebhookDelivery from "../persistence/models/WebhookDelivery";
import WebhookSubscription from "../persistence/models/WebhookSubscription";
import Message from "../../models/Message";
import {
  decryptMessagingSecret,
  loadMessagingKeyring,
  MessagingKeyring
} from "../security/MessagingSecretCipher";
import { signWebhookPayload } from "./WebhookSignature";
import {
  validateResolvedAddress,
  validateWebhookUrl
} from "./WebhookUrlPolicy";

interface ClaimedDelivery {
  id: string;
  companyId: number;
  subscriptionId: string;
  urlSnapshot: string;
  methodSnapshot?: string;
  secretCiphertextSnapshot: string;
  payload: Record<string, any>;
  attemptCount: number;
}

interface PostResult {
  status: number;
  body: string;
  retryAfterSeconds?: number;
}
interface PostInput {
  url: string;
  method: string;
  rawBody: string;
  headers: Record<string, string>;
}

interface DispatcherDependencies {
  claimNext(): Promise<ClaimedDelivery | null>;
  decryptSecret(value: string, keyring: MessagingKeyring): string;
  getKeyring(): MessagingKeyring;
  post(input: PostInput): Promise<PostResult>;
  complete(id: string, status: number): Promise<unknown>;
  retry(
    id: string,
    availableAt: Date,
    status?: number,
    error?: string
  ): Promise<unknown>;
  deadLetter(id: string, status?: number, error?: string): Promise<unknown>;
  recordSuccess(subscriptionId: string): Promise<unknown>;
  recordFailure(subscriptionId: string): Promise<unknown>;
  pauseSubscription(subscriptionId: string): Promise<unknown>;
  now(): Date;
  jitter(maximumMs: number): number;
  hydratePayload?(delivery: ClaimedDelivery): Promise<Record<string, any>>;
}

export const nextSubscriptionFailureState = (
  currentFailures: number,
  now: Date
) => {
  const consecutiveFailures = currentFailures + 1;
  return {
    consecutiveFailures,
    lastFailureAt: now,
    pausedAt: consecutiveFailures >= 50 ? now : undefined
  };
};

const supportedMethods = new Set(["POST", "PUT", "PATCH"]);

const securePost = async ({
  url: value,
  rawBody,
  headers,
  method: rawMethod
}: PostInput): Promise<PostResult> => {
  const method = supportedMethods.has((rawMethod || "").toUpperCase())
    ? rawMethod.toUpperCase()
    : "POST";
  const url = validateWebhookUrl(value);
  const addresses = await dns.lookup(url.hostname, {
    all: true,
    verbatim: true
  });
  if (!addresses.length) throw new Error("Destino de webhook sem DNS");
  addresses.forEach(item => validateResolvedAddress(item.address));
  const selected = addresses[0];

  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method,
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(rawBody)
        },
        timeout: 10000,
        // Node >= 18 invoca o lookup customizado com all: true e espera um
        // array de endereços; devolvemos a lista validada/pinned completa.
        // (a tipagem do LookupFunction só cobre o formato de endereço único)
        lookup: (_hostname, options, callback) => {
          if (options && (options as { all?: boolean }).all) {
            (
              callback as unknown as (
                err: NodeJS.ErrnoException | null,
                all: Array<{ address: string; family: number }>
              ) => void
            )(
              null,
              addresses.map(item => ({
                address: item.address,
                family: item.family
              }))
            );
            return;
          }
          callback(null, selected.address, selected.family);
        }
      },
      response => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", chunk => {
          if (size < 4096) {
            const buffer = Buffer.from(chunk);
            chunks.push(buffer.subarray(0, 4096 - size));
            size += buffer.length;
          }
        });
        response.on("end", () => {
          const retryAfter = response.headers["retry-after"];
          const retryAfterSeconds =
            retryAfter && /^\d+$/.test(retryAfter)
              ? Number(retryAfter)
              : undefined;
          resolve({
            status: response.statusCode || 0,
            body: Buffer.concat(chunks).toString("utf8"),
            retryAfterSeconds
          });
        });
      }
    );
    request.on("timeout", () => request.destroy(new Error("Webhook timeout")));
    request.on("error", reject);
    request.end(rawBody);
  });
};

const defaultDependencies: DispatcherDependencies = {
  claimNext: () =>
    sequelize.transaction(async transaction => {
      const delivery = await WebhookDelivery.findOne({
        where: {
          status: WEBHOOK_DELIVERY_STATUS.READY,
          availableAt: { [Op.lte]: new Date() }
        },
        order: [["createdAt", "ASC"]],
        transaction,
        lock: transaction.LOCK.UPDATE,
        skipLocked: true
      });
      if (!delivery) return null;
      await delivery.update(
        {
          status: WEBHOOK_DELIVERY_STATUS.PROCESSING,
          attemptCount: delivery.attemptCount + 1,
          leaseExpiresAt: new Date(Date.now() + 120000)
        },
        { transaction }
      );
      return delivery.toJSON() as ClaimedDelivery;
    }),
  decryptSecret: decryptMessagingSecret,
  getKeyring: loadMessagingKeyring,
  post: securePost,
  complete: (id, status) =>
    WebhookDelivery.update(
      {
        status: WEBHOOK_DELIVERY_STATUS.DELIVERED,
        responseStatus: status,
        responseBody: null,
        deliveredAt: new Date(),
        leaseExpiresAt: null,
        lastError: null
      },
      { where: { id, status: WEBHOOK_DELIVERY_STATUS.PROCESSING } }
    ),
  retry: (id, availableAt, status, error) =>
    WebhookDelivery.update(
      {
        status: WEBHOOK_DELIVERY_STATUS.READY,
        availableAt,
        responseStatus: status || null,
        lastError: error || null,
        leaseExpiresAt: null
      },
      { where: { id, status: WEBHOOK_DELIVERY_STATUS.PROCESSING } }
    ),
  deadLetter: (id, status, error) =>
    WebhookDelivery.update(
      {
        status: WEBHOOK_DELIVERY_STATUS.DEAD_LETTER,
        responseStatus: status || null,
        lastError: error || null,
        leaseExpiresAt: null
      },
      { where: { id, status: WEBHOOK_DELIVERY_STATUS.PROCESSING } }
    ),
  recordSuccess: subscriptionId =>
    WebhookSubscription.update(
      { consecutiveFailures: 0, lastSuccessAt: new Date() },
      { where: { id: subscriptionId } }
    ),
  recordFailure: subscriptionId =>
    sequelize.transaction(async transaction => {
      const subscription = await WebhookSubscription.findByPk(subscriptionId, {
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!subscription) return;
      const now = new Date();
      const state = nextSubscriptionFailureState(
        subscription.consecutiveFailures,
        now
      );
      await subscription.update(
        { ...state, pausedAt: state.pausedAt || subscription.pausedAt },
        { transaction }
      );
    }),
  pauseSubscription: subscriptionId =>
    WebhookSubscription.update(
      { pausedAt: new Date(), lastFailureAt: new Date() },
      { where: { id: subscriptionId } }
  ),
  now: () => new Date(),
  jitter: maximumMs => Math.floor(Math.random() * Math.max(1, maximumMs)),
  hydratePayload: async delivery => {
    if (
      delivery.payload?.type !== "message.received" ||
      delivery.payload?.data?.actorType !== "contact" ||
      !delivery.payload?.data?.messageId
    ) {
      return delivery.payload;
    }
    const message = await Message.findOne({
      where: {
        id: String(delivery.payload.data.messageId),
        companyId: delivery.companyId
      },
      attributes: ["id", "body"]
    });
    if (!message?.body) return delivery.payload;
    return {
      ...delivery.payload,
      data: { ...delivery.payload.data, text: message.body }
    };
  }
};

class WebhookDeliveryDispatcher {
  // Parameter property keeps transport and persistence ports replaceable.
  // eslint-disable-next-line no-useless-constructor
  constructor(
    private readonly dependencies: DispatcherDependencies = defaultDependencies
  ) {}

  private nextAttempt(delivery: ClaimedDelivery, result?: PostResult): Date {
    const correlationSchedule = [2, 5, 10, 20, 40];
    const generalSchedule = [5, 15, 30, 60, 120];
    const schedule =
      result?.status === 503 ? correlationSchedule : generalSchedule;
    const scheduledSeconds =
      schedule[Math.min(delivery.attemptCount - 1, schedule.length - 1)];
    const retrySeconds = Math.min(
      120,
      Math.max(scheduledSeconds, result?.retryAfterSeconds || 0)
    );
    return new Date(
      this.dependencies.now().getTime() +
        retrySeconds * 1000 +
        this.dependencies.jitter(retrySeconds * 250)
    );
  }

  async dispatchOne(): Promise<{
    status: "idle" | "delivered" | "retry" | "dead_letter";
  }> {
    const delivery = await this.dependencies.claimNext();
    if (!delivery) return { status: "idle" };
    try {
      const outboundPayload = this.dependencies.hydratePayload
        ? await this.dependencies.hydratePayload(delivery)
        : delivery.payload;
      const rawBody = JSON.stringify(outboundPayload);
      const timestamp = Math.floor(
        this.dependencies.now().getTime() / 1000
      ).toString();
      const secret = this.dependencies.decryptSecret(
        delivery.secretCiphertextSnapshot,
        this.dependencies.getKeyring()
      );
      const response = await this.dependencies.post({
        url: delivery.urlSnapshot,
        method: delivery.methodSnapshot || "POST",
        rawBody,
        headers: {
          "X-DiaChat-Timestamp": timestamp,
          "X-DiaChat-Signature": signWebhookPayload(secret, timestamp, rawBody),
          "X-DiaChat-Delivery": delivery.id,
          "X-DiaChat-Event": String(delivery.payload.id)
        }
      });
      if (response.status >= 200 && response.status < 300) {
        await this.dependencies.complete(delivery.id, response.status);
        await this.dependencies.recordSuccess(delivery.subscriptionId);
        return { status: "delivered" };
      }
      if (response.status === 401) {
        await this.dependencies.deadLetter(
          delivery.id,
          response.status,
          `HTTP_${response.status}`
        );
        await this.dependencies.pauseSubscription(delivery.subscriptionId);
        return { status: "dead_letter" };
      }
      if (
        delivery.attemptCount < 6 &&
        (response.status === 429 || response.status >= 500)
      ) {
        await this.dependencies.retry(
          delivery.id,
          this.nextAttempt(delivery, response),
          response.status,
          `HTTP_${response.status}`
        );
        return { status: "retry" };
      }
      await this.dependencies.deadLetter(
        delivery.id,
        response.status,
        `HTTP_${response.status}`
      );
      await this.dependencies.recordFailure(delivery.subscriptionId);
      return { status: "dead_letter" };
    } catch (error) {
      const reason =
        error instanceof Error && error.message === "Webhook timeout"
          ? "WEBHOOK_TIMEOUT"
          : "WEBHOOK_DELIVERY_ERROR";
      if (delivery.attemptCount < 6) {
        await this.dependencies.retry(
          delivery.id,
          this.nextAttempt(delivery),
          undefined,
          reason
        );
        return { status: "retry" };
      }
      await this.dependencies.deadLetter(delivery.id, undefined, reason);
      await this.dependencies.recordFailure(delivery.subscriptionId);
      return { status: "dead_letter" };
    }
  }
}

export default WebhookDeliveryDispatcher;
