import sequelize from "../../database";
import MessagingCapacitySample from "../persistence/models/MessagingCapacitySample";

class MessagingCapacityObserver {
  async observeOne(): Promise<{ status: "idle" | "observed" }> {
    if (process.env.MESSAGING_CAPACITY_PROBE_ENABLED !== "true") {
      return { status: "idle" };
    }
    return sequelize.transaction(async transaction => {
      const sample = await MessagingCapacitySample.findOne({
        where: { status: "ready" },
        order: [["createdAt", "ASC"]],
        transaction,
        lock: transaction.LOCK.UPDATE,
        skipLocked: true
      });
      if (!sample) return { status: "idle" as const };
      await sample.update(
        { status: "observed", observedAt: new Date() },
        { transaction }
      );
      return { status: "observed" as const };
    });
  }
}

export default MessagingCapacityObserver;
