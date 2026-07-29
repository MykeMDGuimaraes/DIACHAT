import WhatsAppProviderEventPublisher from "../application/WhatsAppProviderEventPublisher";
import {
  createProviderEvent,
  WhatsAppProviderEvent,
  WhatsAppProviderEventType
} from "../domain/WhatsAppProviderEvent";

const RUN_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIXTURE_NAME = /^[a-z0-9-]+$/;
const FORBIDDEN_KEY =
  /(?:authorization|cookie|password|secret|token|phone(?:Number)?|jid|lid|url)/i;
const FORBIDDEN_VALUE =
  /(?:@[cs]\.whatsapp\.net|@c\.us|\b55\d{10,13}\b|bearer\s+)/i;
const EVENT_TYPES: readonly WhatsAppProviderEventType[] = [
  "message.received",
  "button.clicked",
  "message.reaction",
  "message.edited",
  "message.deleted",
  "message.status.updated",
  "chat.updated",
  "connection.updated"
];

interface ReplayDependencies {
  publish(events: readonly WhatsAppProviderEvent[]): Promise<void>;
  now(): Date;
}

interface ReplayRequest {
  runId: string;
  sequence: number;
  whatsappId: number;
  fixture: {
    name: string;
    provider: "baileys" | "meta_cloud";
    event: Record<string, unknown>;
  };
}

const defaultPublisher = new WhatsAppProviderEventPublisher();
const defaults: ReplayDependencies = {
  publish: events => defaultPublisher.publish(events),
  now: () => new Date()
};

const validateSyntheticValue = (value: unknown, location: string): void => {
  if (typeof value === "string" && FORBIDDEN_VALUE.test(value)) {
    throw new Error(`Replay fixture insegura em ${location}`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateSyntheticValue(item, `${location}[${index}]`)
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    if (FORBIDDEN_KEY.test(key)) {
      throw new Error(`Replay fixture nao permite ${key}`);
    }
    validateSyntheticValue(item, `${location}.${key}`);
  });
};

class WhatsAppMirrorReplayService {
  private readonly dependencies: ReplayDependencies;

  constructor(dependencies: Partial<ReplayDependencies> = {}) {
    this.dependencies = { ...defaults, ...dependencies };
  }

  async replay(
    companyId: number,
    request: ReplayRequest
  ): Promise<{ accepted: true; sequence: number }> {
    if (!Number.isSafeInteger(companyId) || companyId < 1) {
      throw new Error("Replay exige companyId autenticado");
    }
    if (!RUN_ID.test(request?.runId || "")) {
      throw new Error("Replay runId invalido");
    }
    if (!Number.isSafeInteger(request?.sequence) || request.sequence < 0) {
      throw new Error("Replay sequence invalida");
    }
    if (!Number.isSafeInteger(request?.whatsappId) || request.whatsappId < 1) {
      throw new Error("Replay whatsappId invalido");
    }
    if (!FIXTURE_NAME.test(request?.fixture?.name || "")) {
      throw new Error("Replay fixture name invalido");
    }
    if (!["baileys", "meta_cloud"].includes(request.fixture.provider)) {
      throw new Error("Replay provider invalido");
    }
    validateSyntheticValue(request.fixture.event, "$.fixture.event");
    const eventType = request.fixture.event
      .eventType as WhatsAppProviderEventType;
    if (!EVENT_TYPES.includes(eventType)) {
      throw new Error("Replay eventType invalido");
    }

    const syntheticId = `fixture-${request.runId}`;
    const messageId = `${syntheticId}-${request.sequence}`;
    const occurredAt = this.dependencies.now();
    const event = createProviderEvent({
      context: {
        companyId,
        whatsappId: request.whatsappId,
        conversationId: syntheticId,
        contactId: syntheticId,
        externalTicketId: syntheticId,
        automationEpoch: 1
      },
      eventType,
      providerName: request.fixture.provider,
      providerEventId: `capacity-${request.runId}-${request.sequence}`,
      messageId,
      occurredAt,
      revision: String(request.sequence),
      actorType:
        typeof request.fixture.event.actorType === "string"
          ? request.fixture.event.actorType
          : "system",
      kind:
        typeof request.fixture.event.kind === "string"
          ? request.fixture.event.kind
          : null,
      fromMe:
        typeof request.fixture.event.fromMe === "boolean"
          ? request.fixture.event.fromMe
          : null,
      text:
        typeof request.fixture.event.text === "string"
          ? request.fixture.event.text
          : null,
      interactive:
        (request.fixture.event.interactive as Record<string, unknown>) || null,
      reaction:
        (request.fixture.event.reaction as Record<string, unknown>) || null,
      edit: (request.fixture.event.edit as Record<string, unknown>) || null,
      delete: (request.fixture.event.delete as Record<string, unknown>) || null
    });
    if (typeof request.fixture.event.status === "string") {
      event.payload.message.status = request.fixture.event.status;
    }
    if (typeof request.fixture.event.state === "string") {
      event.payload.connection.state = request.fixture.event.state;
    }
    await this.dependencies.publish([event]);
    return { accepted: true, sequence: request.sequence };
  }
}

export default WhatsAppMirrorReplayService;
