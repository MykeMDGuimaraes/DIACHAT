import Whatsapp from "../../models/Whatsapp";
import {
  CHANNEL_DELIVERY_HEALTH,
  DELIVERY_HEALTH_WINDOW_MS
} from "../domain/MessagingStates";
import {
  DELIVERY_ALERT,
  DELIVERY_METRIC,
  emitDeliveryAlert,
  incrementDeliveryCounter
} from "../telemetry/DeliveryObservability";

interface Dependencies {
  findChannelForUpdate(
    whatsappId: number,
    transaction: any
  ): Promise<Whatsapp | null>;
  now(): Date;
}

const defaultDependencies: Dependencies = {
  findChannelForUpdate: (whatsappId, transaction) =>
    Whatsapp.findOne({
      where: { id: whatsappId },
      transaction,
      lock: transaction.LOCK.UPDATE
    }),
  now: () => new Date()
};

/**
 * Saúde de entrega do canal (Hardening T5).
 *
 * - Duas falhas de confirmação de entrega consecutivas dentro de
 *   DELIVERY_HEALTH_WINDOW_MS degradam o canal (deliveryHealth = degraded);
 *   uma falha isolada apenas registra o contador — nunca degrada.
 * - Um ACK tardio (ou qualquer avanço delivered/read) confirma a entrega:
 *   zera o contador e restaura healthy.
 *
 * Ambos os métodos rodam DENTRO da transação do chamador (bloqueio de linha)
 * e retornam o canal apenas quando a saúde mudou. O módulo de mensageria não
 * emite socket (fronteira core<->messaging): cabe ao chamador devolver o
 * canal ao núcleo, que notifica DEPOIS do commit.
 */
class ChannelDeliveryHealthService {
  private readonly dependencies: Dependencies;

  constructor(dependencies: Partial<Dependencies> = {}) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  async recordUnconfirmedDelivery(
    whatsappId: number,
    errorCode: string,
    transaction: any
  ): Promise<Whatsapp | null> {
    if (whatsappId === undefined || whatsappId === null) return null;
    const channel = await this.dependencies.findChannelForUpdate(
      whatsappId,
      transaction
    );
    if (!channel) return null;

    const now = this.dependencies.now();
    const lastFailureAt = channel.lastUnconfirmedDeliveryAt
      ? new Date(channel.lastUnconfirmedDeliveryAt)
      : null;
    const withinWindow =
      lastFailureAt !== null &&
      now.getTime() - lastFailureAt.getTime() <= DELIVERY_HEALTH_WINDOW_MS;
    const consecutive = withinWindow
      ? Number(channel.consecutiveUnconfirmedDeliveries || 0) + 1
      : 1;

    const shouldDegrade = consecutive >= 2;
    const changesNow =
      shouldDegrade &&
      channel.deliveryHealth !== CHANNEL_DELIVERY_HEALTH.DEGRADED;

    await channel.update(
      {
        consecutiveUnconfirmedDeliveries: consecutive,
        lastUnconfirmedDeliveryAt: now,
        lastDeliveryErrorCode: errorCode,
        ...(shouldDegrade
          ? {
              deliveryHealth: CHANNEL_DELIVERY_HEALTH.DEGRADED,
              ...(changesNow ? { deliveryHealthChangedAt: now } : {})
            }
          : {})
      },
      { transaction }
    );

    // Métrica + alerta crítico (T7): >2 não confirmadas em 10min no canal.
    incrementDeliveryCounter(DELIVERY_METRIC.DELIVERY_UNCONFIRMED_TOTAL, {
      whatsappId
    });
    if (changesNow) {
      emitDeliveryAlert(
        "critical",
        DELIVERY_ALERT.DELIVERY_UNCONFIRMED_THRESHOLD,
        { whatsappId, errorCode, consecutiveUnconfirmed: consecutive }
      );
    }

    return changesNow ? channel : null;
  }

  async recordConfirmedDelivery(
    whatsappId: number,
    transaction: any
  ): Promise<Whatsapp | null> {
    if (whatsappId === undefined || whatsappId === null) return null;
    const channel = await this.dependencies.findChannelForUpdate(
      whatsappId,
      transaction
    );
    if (!channel) return null;

    const now = this.dependencies.now();
    const wasDegraded =
      channel.deliveryHealth === CHANNEL_DELIVERY_HEALTH.DEGRADED;
    const hasFailureState =
      Number(channel.consecutiveUnconfirmedDeliveries || 0) > 0 ||
      channel.lastDeliveryErrorCode !== null;

    if (!wasDegraded && !hasFailureState) {
      await channel.update({ lastConfirmedDeliveryAt: now }, { transaction });
      return null;
    }

    await channel.update(
      {
        consecutiveUnconfirmedDeliveries: 0,
        lastDeliveryErrorCode: null,
        lastConfirmedDeliveryAt: now,
        deliveryHealth: CHANNEL_DELIVERY_HEALTH.HEALTHY,
        ...(wasDegraded ? { deliveryHealthChangedAt: now } : {})
      },
      { transaction }
    );

    return wasDegraded ? channel : null;
  }
}

export default ChannelDeliveryHealthService;
