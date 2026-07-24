import { promises as dns } from "dns";
import https from "https";
import { Op } from "sequelize";

import sequelize from "../../database";
import WebhookDelivery from "../persistence/models/WebhookDelivery";
import WebhookSubscription from "../persistence/models/WebhookSubscription";
import { decryptMessagingSecret, loadMessagingKeyring, MessagingKeyring } from "../security/MessagingSecretCipher";
import { signWebhookPayload } from "./WebhookSignature";
import { validateResolvedAddress, validateWebhookUrl } from "./WebhookUrlPolicy";

interface ClaimedDelivery {
  id: string;
  subscriptionId: string;
  urlSnapshot: string;
  secretCiphertextSnapshot: string;
  payload: Record<string, any>;
  attemptCount: number;
}

interface PostResult { status: number; body: string; retryAfterSeconds?: number; }
interface PostInput { url: string; rawBody: string; headers: Record<string, string>; }

interface DispatcherDependencies {
  claimNext(): Promise<ClaimedDelivery | null>;
  decryptSecret(value: string, keyring: MessagingKeyring): string;
  getKeyring(): MessagingKeyring;
  post(input: PostInput): Promise<PostResult>;
  complete(id: string, status: number, body: string): Promise<unknown>;
  retry(id: string, availableAt: Date, status?: number, error?: string): Promise<unknown>;
  deadLetter(id: string, status?: number, error?: string): Promise<unknown>;
  recordSuccess(subscriptionId: string): Promise<unknown>;
  recordFailure(subscriptionId: string): Promise<unknown>;
  now(): Date;
  jitter(maximumMs: number): number;
}

export const nextSubscriptionFailureState = (currentFailures: number, now: Date) => {
  const consecutiveFailures = currentFailures + 1;
  return {
    consecutiveFailures,
    lastFailureAt: now,
    pausedAt: consecutiveFailures >= 50 ? now : undefined
  };
};

const securePost = async ({ url: value, rawBody, headers }: PostInput): Promise<PostResult> => {
  const url = validateWebhookUrl(value);
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length) throw new Error("Destino de webhook sem DNS");
  addresses.forEach(item => validateResolvedAddress(item.address));
  const selected = addresses[0];

  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(rawBody) },
      timeout: 10000,
      lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family)
    }, response => {
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
        const retryAfterSeconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined;
        resolve({ status: response.statusCode || 0, body: Buffer.concat(chunks).toString("utf8"), retryAfterSeconds });
      });
    });
    request.on("timeout", () => request.destroy(new Error("Webhook timeout")));
    request.on("error", reject);
    request.end(rawBody);
  });
};

const defaultDependencies: DispatcherDependencies = {
  claimNext: () => sequelize.transaction(async transaction => {
    const delivery = await WebhookDelivery.findOne({
      where: { status: "ready", availableAt: { [Op.lte]: new Date() } },
      order: [["createdAt", "ASC"]], transaction, lock: transaction.LOCK.UPDATE, skipLocked: true
    });
    if (!delivery) return null;
    await delivery.update({ status: "processing", attemptCount: delivery.attemptCount + 1, leaseExpiresAt: new Date(Date.now() + 120000) }, { transaction });
    return delivery.toJSON() as ClaimedDelivery;
  }),
  decryptSecret: decryptMessagingSecret,
  getKeyring: loadMessagingKeyring,
  post: securePost,
  complete: (id, status, body) => WebhookDelivery.update({ status: "delivered", responseStatus: status, responseBody: body, deliveredAt: new Date(), leaseExpiresAt: null, lastError: null }, { where: { id, status: "processing" } }),
  retry: (id, availableAt, status, error) => WebhookDelivery.update({ status: "ready", availableAt, responseStatus: status || null, lastError: error || null, leaseExpiresAt: null }, { where: { id, status: "processing" } }),
  deadLetter: (id, status, error) => WebhookDelivery.update({ status: "dead_letter", responseStatus: status || null, lastError: error || null, leaseExpiresAt: null }, { where: { id, status: "processing" } }),
  recordSuccess: subscriptionId => WebhookSubscription.update({ consecutiveFailures: 0, lastSuccessAt: new Date() }, { where: { id: subscriptionId } }),
  recordFailure: subscriptionId => sequelize.transaction(async transaction => {
    const subscription = await WebhookSubscription.findByPk(subscriptionId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!subscription) return;
    const now = new Date();
    const state = nextSubscriptionFailureState(subscription.consecutiveFailures, now);
    await subscription.update({ ...state, pausedAt: state.pausedAt || subscription.pausedAt }, { transaction });
  }),
  now: () => new Date(),
  jitter: maximumMs => Math.floor(Math.random() * Math.max(1, maximumMs))
};

class WebhookDeliveryDispatcher {
  constructor(private readonly dependencies: DispatcherDependencies = defaultDependencies) {}

  private nextAttempt(delivery: ClaimedDelivery, result?: PostResult): Date {
    const baseSeconds = Math.min(3600, 30 * 2 ** Math.max(0, delivery.attemptCount - 1));
    const retrySeconds = Math.min(3600, result?.retryAfterSeconds || baseSeconds);
    return new Date(this.dependencies.now().getTime() + retrySeconds * 1000 + this.dependencies.jitter(retrySeconds * 250));
  }

  async dispatchOne(): Promise<{ status: "idle" | "delivered" | "retry" | "dead_letter" }> {
    const delivery = await this.dependencies.claimNext();
    if (!delivery) return { status: "idle" };
    const rawBody = JSON.stringify(delivery.payload);
    const timestamp = Math.floor(this.dependencies.now().getTime() / 1000).toString();
    const secret = this.dependencies.decryptSecret(delivery.secretCiphertextSnapshot, this.dependencies.getKeyring());
    try {
      const response = await this.dependencies.post({
        url: delivery.urlSnapshot,
        rawBody,
        headers: {
          "X-DiaChat-Timestamp": timestamp,
          "X-DiaChat-Signature": signWebhookPayload(secret, timestamp, rawBody),
          "X-DiaChat-Delivery": delivery.id,
          "X-DiaChat-Event": String(delivery.payload.id)
        }
      });
      if (response.status >= 200 && response.status < 300) {
        await this.dependencies.complete(delivery.id, response.status, response.body);
        await this.dependencies.recordSuccess(delivery.subscriptionId);
        return { status: "delivered" };
      }
      if (delivery.attemptCount < 6 && (response.status === 429 || response.status >= 500)) {
        await this.dependencies.retry(delivery.id, this.nextAttempt(delivery, response), response.status, response.body);
        return { status: "retry" };
      }
      await this.dependencies.deadLetter(delivery.id, response.status, response.body);
      await this.dependencies.recordFailure(delivery.subscriptionId);
      return { status: "dead_letter" };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Falha de webhook";
      if (delivery.attemptCount < 6) {
        await this.dependencies.retry(delivery.id, this.nextAttempt(delivery), undefined, reason);
        return { status: "retry" };
      }
      await this.dependencies.deadLetter(delivery.id, undefined, reason);
      await this.dependencies.recordFailure(delivery.subscriptionId);
      return { status: "dead_letter" };
    }
  }
}

export default WebhookDeliveryDispatcher;
