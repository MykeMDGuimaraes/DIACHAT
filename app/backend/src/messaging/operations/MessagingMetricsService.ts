import { Op } from "sequelize";
import sequelize from "../../database";
import MessageCommand from "../persistence/models/MessageCommand";
import MessagingInboxEvent from "../persistence/models/MessagingInboxEvent";
import MessagingOutboxEvent from "../persistence/models/MessagingOutboxEvent";
import WebhookDelivery from "../persistence/models/WebhookDelivery";
import WebhookSubscription from "../persistence/models/WebhookSubscription";
import {
  lastRetentionError,
  lastRetentionResult
} from "./MessagingRetentionService";
import MessagingCapacitySample from "../persistence/models/MessagingCapacitySample";
import AuditLog from "../../models/AuditLog";
import {
  MESSAGE_COMMAND_ERROR_CODE,
  MESSAGE_COMMAND_STATUS,
  OUTBOX_EVENT_STATUS
} from "../domain/MessagingStates";

const oldestAgeSeconds = (createdAt?: Date | null): number =>
  createdAt
    ? Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 1000))
    : 0;

const graphLifecycle = () => {
  const sunsetAt = process.env.META_GRAPH_SUNSET_AT;
  const parsed = sunsetAt ? new Date(sunsetAt) : null;
  const daysUntilSunset =
    parsed && !Number.isNaN(parsed.getTime())
      ? Math.ceil((parsed.getTime() - Date.now()) / 86_400_000)
      : null;
  return {
    version: process.env.META_GRAPH_VERSION || null,
    sunsetAt: parsed?.toISOString() || null,
    daysUntilSunset,
    alert: daysUntilSunset !== null && daysUntilSunset <= 90
  };
};

class MessagingMetricsService {
  async collect(companyId?: number): Promise<Record<string, unknown>> {
    const companyWhere = companyId ? { companyId } : {};
    const now = new Date();
    const [
      commandsQueued,
      commandsInFlight,
      commandsUnknown,
      commandsFailed,
      commandsDeadLetter,
      commandsExpiredLeases,
      outboxReady,
      outboxInFlight,
      outboxDeadLetter,
      outboxExpiredLeases,
      inboxPending,
      webhookReady,
      webhookDead,
      pausedSubscriptions,
      oldestCommand,
      oldestOutbox,
      oldestWebhook,
      capacityReady,
      capacityObservedLastMinute,
      oldestCapacity
    ] = await Promise.all([
      MessageCommand.count({
        where: { ...companyWhere, status: MESSAGE_COMMAND_STATUS.QUEUED }
      }),
      MessageCommand.count({
        where: { ...companyWhere, status: MESSAGE_COMMAND_STATUS.SENDING }
      }),
      MessageCommand.count({
        where: { ...companyWhere, status: MESSAGE_COMMAND_STATUS.UNKNOWN }
      }),
      MessageCommand.count({
        where: { ...companyWhere, status: MESSAGE_COMMAND_STATUS.FAILED }
      }),
      MessageCommand.count({
        where: {
          ...companyWhere,
          status: MESSAGE_COMMAND_STATUS.FAILED,
          errorCode: MESSAGE_COMMAND_ERROR_CODE.SEND_RETRY_EXHAUSTED
        }
      }),
      MessageCommand.count({
        where: {
          ...companyWhere,
          status: MESSAGE_COMMAND_STATUS.SENDING,
          leaseExpiresAt: { [Op.lte]: now }
        }
      }),
      MessagingOutboxEvent.count({
        where: { ...companyWhere, status: OUTBOX_EVENT_STATUS.READY }
      }),
      MessagingOutboxEvent.count({
        where: { ...companyWhere, status: OUTBOX_EVENT_STATUS.PROCESSING }
      }),
      MessagingOutboxEvent.count({
        where: { ...companyWhere, status: OUTBOX_EVENT_STATUS.DEAD_LETTER }
      }),
      MessagingOutboxEvent.count({
        where: {
          ...companyWhere,
          status: OUTBOX_EVENT_STATUS.PROCESSING,
          leaseExpiresAt: { [Op.lte]: now }
        }
      }),
      MessagingInboxEvent.count({
        where: { ...companyWhere, status: "received" }
      }),
      WebhookDelivery.count({ where: { ...companyWhere, status: "ready" } }),
      WebhookDelivery.count({
        where: { ...companyWhere, status: "dead_letter" }
      }),
      WebhookSubscription.count({
        where: { ...companyWhere, pausedAt: { [Op.not]: null } }
      }),
      MessageCommand.findOne({
        where: {
          ...companyWhere,
          status: {
            [Op.in]: [
              MESSAGE_COMMAND_STATUS.QUEUED,
              MESSAGE_COMMAND_STATUS.SENDING
            ]
          }
        },
        attributes: ["createdAt"],
        order: [["createdAt", "ASC"]]
      }),
      MessagingOutboxEvent.findOne({
        where: {
          ...companyWhere,
          status: {
            [Op.in]: [OUTBOX_EVENT_STATUS.READY, OUTBOX_EVENT_STATUS.PROCESSING]
          }
        },
        attributes: ["createdAt"],
        order: [["createdAt", "ASC"]]
      }),
      WebhookDelivery.findOne({
        where: { ...companyWhere, status: { [Op.in]: ["ready", "leased"] } },
        attributes: ["createdAt"],
        order: [["createdAt", "ASC"]]
      }),
      MessagingCapacitySample.count({
        where: { ...companyWhere, status: "ready" }
      }),
      MessagingCapacitySample.count({
        where: {
          ...companyWhere,
          status: "observed",
          observedAt: { [Op.gte]: new Date(Date.now() - 60_000) }
        }
      }),
      MessagingCapacitySample.findOne({
        where: { ...companyWhere, status: "ready" },
        attributes: ["createdAt"],
        order: [["createdAt", "ASC"]]
      })
    ]);

    const pool = (sequelize.connectionManager as any).pool;
    const legacyWhere = {
      ...(companyId ? { companyId } : {}),
      action: "legacy_messages_send_accessed"
    };
    const [legacyCallsLast14Days, lastLegacyCall] = await Promise.all([
      AuditLog.count({
        where: {
          ...legacyWhere,
          createdAt: { [Op.gte]: new Date(Date.now() - 14 * 86_400_000) }
        }
      }),
      AuditLog.findOne({
        where: legacyWhere,
        attributes: ["createdAt"],
        order: [["createdAt", "DESC"]]
      })
    ]);
    const configuredLegacySunset = new Date(
      process.env.LEGACY_MESSAGES_API_SUNSET_AT || "2026-09-22T00:00:00.000Z"
    );
    const legacySunset = Number.isNaN(configuredLegacySunset.getTime())
      ? new Date("2026-09-22T00:00:00.000Z")
      : configuredLegacySunset;
    return {
      collectedAt: new Date().toISOString(),
      companyId: companyId || null,
      commands: {
        queued: commandsQueued,
        inFlight: commandsInFlight,
        unknown: commandsUnknown,
        failed: commandsFailed,
        deadLetter: commandsDeadLetter,
        expiredLeases: commandsExpiredLeases,
        oldestPendingSeconds: oldestAgeSeconds(oldestCommand?.createdAt)
      },
      outbox: {
        ready: outboxReady,
        inFlight: outboxInFlight,
        deadLetter: outboxDeadLetter,
        expiredLeases: outboxExpiredLeases,
        oldestPendingSeconds: oldestAgeSeconds(oldestOutbox?.createdAt)
      },
      alerts: {
        deadLetter: commandsDeadLetter > 0 || outboxDeadLetter > 0
      },
      inbox: { pending: inboxPending },
      webhooks: {
        ready: webhookReady,
        deadLetter: webhookDead,
        pausedSubscriptions,
        oldestPendingSeconds: oldestAgeSeconds(oldestWebhook?.createdAt)
      },
      capacityObservation: {
        ready: capacityReady,
        observedLastMinute: capacityObservedLastMinute,
        oldestPendingSeconds: oldestAgeSeconds(oldestCapacity?.createdAt)
      },
      process: process.memoryUsage(),
      postgresPool: pool
        ? {
            size: pool.size,
            available: pool.available,
            using: pool.using,
            waiting: pool.waiting
          }
        : null,
      retention: {
        lastResult: lastRetentionResult,
        lastError: lastRetentionError,
        lastSuccessAgeSeconds: lastRetentionResult
          ? oldestAgeSeconds(new Date(lastRetentionResult.ranAt))
          : null
      },
      metaGraph: graphLifecycle(),
      legacyApi: {
        sunsetAt: legacySunset.toISOString(),
        callsLast14Days: legacyCallsLast14Days,
        lastCallAt: lastLegacyCall?.createdAt?.toISOString() || null,
        eligibleForGone:
          Date.now() >= legacySunset.getTime() && legacyCallsLast14Days === 0
      }
    };
  }
}

export default MessagingMetricsService;
