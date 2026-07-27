import { Op } from "sequelize";
import MessagingInboxEvent from "../../persistence/models/MessagingInboxEvent";

class MetaInboxRecoveryService {
  async recover(now = new Date()): Promise<{ recovered: number }> {
    const [recovered] = await MessagingInboxEvent.update(
      { status: "received", availableAt: now, leaseExpiresAt: null },
      {
        where: {
          provider: "meta_cloud",
          status: "processing",
          leaseExpiresAt: { [Op.lte]: now }
        }
      }
    );
    return { recovered };
  }
}

export default MetaInboxRecoveryService;
