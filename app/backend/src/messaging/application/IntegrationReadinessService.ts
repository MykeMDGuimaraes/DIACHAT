import { Op } from "sequelize";

import AppError from "../../errors/AppError";
import Queue from "../../models/Queue";
import Whatsapp from "../../models/Whatsapp";

interface ReadinessInput {
  companyId: number;
  allowedConnectionIds: number[];
  connectionId: number;
  automationQueueId: string;
  humanQueueId: string;
}

interface ReadinessDependencies {
  findConnection(companyId: number, connectionId: number): Promise<any | null>;
  findQueues(companyId: number, queueIds: number[]): Promise<any[]>;
}

const defaultDependencies: ReadinessDependencies = {
  findConnection: (companyId, connectionId) =>
    Whatsapp.findOne({ where: { id: connectionId, companyId } }),
  findQueues: (companyId, queueIds) =>
    Queue.findAll({
      where: { companyId, id: { [Op.in]: queueIds } },
      order: [["id", "ASC"]]
    })
};

const parseId = (value: string): number => {
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new AppError("INVALID_READINESS_CONFIGURATION", 422);
  }
  return Number(value);
};

class IntegrationReadinessService {
  // Parameter property keeps readiness probes deterministic in tests.
  // eslint-disable-next-line no-useless-constructor
  constructor(
    private readonly dependencies: ReadinessDependencies = defaultDependencies
  ) {}

  async check(input: ReadinessInput): Promise<{
    ready: boolean;
    connection: { id: number; status: string };
    queues: Array<{ id: string; name?: string }>;
    capabilities: { buttons: boolean };
  }> {
    if (
      !Number.isInteger(input.connectionId) ||
      !input.allowedConnectionIds.includes(input.connectionId)
    ) {
      throw new AppError("Canal de WhatsApp nao autorizado", 403);
    }
    const queueIds = [
      parseId(input.automationQueueId),
      parseId(input.humanQueueId)
    ];
    if (queueIds[0] === queueIds[1]) {
      throw new AppError("READINESS_QUEUES_MUST_DIFFER", 422);
    }
    const [connection, queues] = await Promise.all([
      this.dependencies.findConnection(input.companyId, input.connectionId),
      this.dependencies.findQueues(input.companyId, queueIds)
    ]);
    if (!connection)
      throw new AppError("Canal de WhatsApp nao encontrado", 404);
    const connected = ["connected", "open"].includes(
      String(connection.status || "").toLowerCase()
    );
    const buttons =
      String(connection.channelType || "baileys").toLowerCase() !==
      "meta_cloud";
    const queueById = new Map(queues.map(queue => [Number(queue.id), queue]));
    const resolvedQueues = queueIds
      .filter(id => queueById.has(id))
      .map(id => {
        const queue = queueById.get(id);
        return {
          id: String(queue.id),
          ...(queue.name ? { name: queue.name } : {})
        };
      });
    return {
      ready: connected && buttons && resolvedQueues.length === 2,
      connection: {
        id: Number(connection.id),
        status: connected ? "connected" : "disconnected"
      },
      queues: resolvedQueues,
      capabilities: { buttons }
    };
  }
}

export default IntegrationReadinessService;
