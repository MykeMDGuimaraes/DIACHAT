import { promises as dns } from "dns";
import https from "https";
import { randomUUID } from "crypto";
import { Op } from "sequelize";

import sequelize from "../../database";
import { WEBHOOK_DELIVERY_STATUS } from "../domain/MessagingStates";
import WebhookDelivery from "../persistence/models/WebhookDelivery";
import WebhookSubscription from "../persistence/models/WebhookSubscription";
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
import {
  decryptWebhookBody,
  EncryptedWebhookBody,
  WebhookBodyBinding
} from "./WebhookBodyCipher";

export const WEBHOOK_DEAD_LETTER_RETENTION_MS = 168 * 60 * 60 * 1000;

interface ClaimedDelivery {
  id: string;
  companyId: number;
  subscriptionId: string;
  eventId: string;
  eventType: string;
  urlSnapshot: string;
  methodSnapshot?: string;
  secretCiphertextSnapshot: string;
  payload: Record<string, any>;
  attemptCount: number;
  leaseToken: string;
  bodyCiphertext: string;
  bodyKeyVersion: string;
  bodySha256: string;
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
  decryptBody(
    encrypted: EncryptedWebhookBody,
    binding: WebhookBodyBinding,
    keyring: MessagingKeyring
  ): Buffer;
  decryptSecret(value: string, keyring: MessagingKeyring): string;
  getKeyring(): MessagingKeyring;
  post(input: PostInput): Promise<PostResult>;
  complete(id: string, leaseToken: string, status: number): Promise<unknown>;
  retry(
    id: string,
    leaseToken: string,
    availableAt: Date,
    status?: number,
    error?: string
  ): Promise<unknown>;
  deadLetter(
    id: string,
    leaseToken: string,
    bodyExpiresAt: Date,
    status?: number,
    error?: string
  ): Promise<unknown>;
  recordSuccess(subscriptionId: string): Promise<unknown>;
  recordFailure(subscriptionId: string): Promise<unknown>;
  pauseSubscription(subscriptionId: string): Promise<unknown>;
  now(): Date;
  jitter(maximumMs: number): number;
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
      const leaseToken = randomUUID();
      const now = new Date();
      const delivery = await WebhookDelivery.findOne({
        where: {
          status: WEBHOOK_DELIVERY_STATUS.READY,
          availableAt: { [Op.lte]: now },
          bodyCiphertext: { [Op.ne]: null },
          bodyPurgedAt: null,
          [Op.or]: [
            { bodyExpiresAt: null },
            { bodyExpiresAt: { [Op.gt]: now } }
          ]
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
          leaseExpiresAt: new Date(now.getTime() + 120000),
          leaseToken
        },
        { transaction }
      );
      return delivery.toJSON() as ClaimedDelivery;
    }),
  decryptBody: decryptWebhookBody,
  decryptSecret: decryptMessagingSecret,
  getKeyring: loadMessagingKeyring,
  post: securePost,
  complete: (id, leaseToken, status) =>
    WebhookDelivery.update(
      {
        status: WEBHOOK_DELIVERY_STATUS.DELIVERED,
        responseStatus: status,
        responseBody: null,
        deliveredAt: new Date(),
        leaseExpiresAt: null,
        leaseToken: null,
        bodyCiphertext: null,
        bodyKeyVersion: null,
        bodyExpiresAt: null,
        bodyPurgedAt: new Date(),
        lastError: null
      },
      {
        where: {
          id,
          status: WEBHOOK_DELIVERY_STATUS.PROCESSING,
          leaseToken
        }
      }
    ),
  retry: (id, leaseToken, availableAt, status, error) =>
    WebhookDelivery.update(
      {
        status: WEBHOOK_DELIVERY_STATUS.READY,
        availableAt,
        responseStatus: status || null,
        lastError: error || null,
        leaseExpiresAt: null,
        leaseToken: null
      },
      {
        where: {
          id,
          status: WEBHOOK_DELIVERY_STATUS.PROCESSING,
          leaseToken
        }
      }
    ),
  deadLetter: (id, leaseToken, bodyExpiresAt, status, error) =>
    WebhookDelivery.update(
      {
        status: WEBHOOK_DELIVERY_STATUS.DEAD_LETTER,
        responseStatus: status || null,
        lastError: error || null,
        leaseExpiresAt: null,
        leaseToken: null,
        bodyExpiresAt
      },
      {
        where: {
          id,
          status: WEBHOOK_DELIVERY_STATUS.PROCESSING,
          leaseToken
        }
      }
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
  jitter: maximumMs => Math.floor(Math.random() * Math.max(1, maximumMs))
};

const wasFenced = (result: unknown): boolean =>
  !(
    result === 0 ||
    result === false ||
    (Array.isArray(result) && result[0] === 0)
  );

class WebhookDeliveryDispatcher {
  private readonly dependencies: DispatcherDependencies;

  constructor(dependencies: Partial<DispatcherDependencies> = {}) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  private bodyExpiresAt(): Date {
    return new Date(
      this.dependencies.now().getTime() + WEBHOOK_DEAD_LETTER_RETENTION_MS
    );
  }

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
      const keyring = this.dependencies.getKeyring();
      const rawBody = this.dependencies
        .decryptBody(
          {
            bodyCiphertext: delivery.bodyCiphertext,
            bodyKeyVersion: delivery.bodyKeyVersion,
            bodySha256: delivery.bodySha256
          },
          {
            companyId: delivery.companyId,
            subscriptionId: delivery.subscriptionId,
            deliveryId: delivery.id,
            eventId: delivery.eventId
          },
          keyring
        )
        .toString("utf8");
      const timestamp = Math.floor(
        this.dependencies.now().getTime() / 1000
      ).toString();
      const secret = this.dependencies.decryptSecret(
        delivery.secretCiphertextSnapshot,
        keyring
      );
      const response = await this.dependencies.post({
        url: delivery.urlSnapshot,
        method: delivery.methodSnapshot || "POST",
        rawBody,
        headers: {
          "X-DiaChat-Timestamp": timestamp,
          "X-DiaChat-Signature": signWebhookPayload(secret, timestamp, rawBody),
          "X-DiaChat-Delivery": delivery.id,
          "X-DiaChat-Event": delivery.eventId
        }
      });
      if (response.status >= 200 && response.status < 300) {
        const completed = await this.dependencies.complete(
          delivery.id,
          delivery.leaseToken,
          response.status
        );
        if (!wasFenced(completed)) return { status: "idle" };
        await this.dependencies.recordSuccess(delivery.subscriptionId);
        return { status: "delivered" };
      }
      if (response.status === 401) {
        const deadLettered = await this.dependencies.deadLetter(
          delivery.id,
          delivery.leaseToken,
          this.bodyExpiresAt(),
          response.status,
          `HTTP_${response.status}`
        );
        if (!wasFenced(deadLettered)) return { status: "idle" };
        await this.dependencies.pauseSubscription(delivery.subscriptionId);
        return { status: "dead_letter" };
      }
      if (
        delivery.attemptCount < 6 &&
        (response.status === 429 || response.status >= 500)
      ) {
        const retried = await this.dependencies.retry(
          delivery.id,
          delivery.leaseToken,
          this.nextAttempt(delivery, response),
          response.status,
          `HTTP_${response.status}`
        );
        if (!wasFenced(retried)) return { status: "idle" };
        return { status: "retry" };
      }
      const deadLettered = await this.dependencies.deadLetter(
        delivery.id,
        delivery.leaseToken,
        this.bodyExpiresAt(),
        response.status,
        `HTTP_${response.status}`
      );
      if (!wasFenced(deadLettered)) return { status: "idle" };
      await this.dependencies.recordFailure(delivery.subscriptionId);
      return { status: "dead_letter" };
    } catch (error) {
      const reason =
        error instanceof Error && error.message === "Webhook timeout"
          ? "WEBHOOK_TIMEOUT"
          : "WEBHOOK_DELIVERY_ERROR";
      if (delivery.attemptCount < 6) {
        const retried = await this.dependencies.retry(
          delivery.id,
          delivery.leaseToken,
          this.nextAttempt(delivery),
          undefined,
          reason
        );
        if (!wasFenced(retried)) return { status: "idle" };
        return { status: "retry" };
      }
      const deadLettered = await this.dependencies.deadLetter(
        delivery.id,
        delivery.leaseToken,
        this.bodyExpiresAt(),
        undefined,
        reason
      );
      if (!wasFenced(deadLettered)) return { status: "idle" };
      await this.dependencies.recordFailure(delivery.subscriptionId);
      return { status: "dead_letter" };
    }
  }
}

export default WebhookDeliveryDispatcher;
