import WhatsAppProviderEventPublisher from "../application/WhatsAppProviderEventPublisher";
import { WhatsAppProviderEvent } from "../domain/WhatsAppProviderEvent";
import {
  adaptBaileysChatUpdate,
  adaptBaileysConnectionUpdate,
  adaptBaileysMessageEvents
} from "../adapters/baileys/BaileysProviderEventAdapter";
import {
  adaptMetaChatUpdate,
  adaptMetaConnectionUpdate,
  adaptMetaMessageEvents
} from "../adapters/meta-cloud/MetaProviderEventAdapter";

const RUN_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIXTURE_NAME = /^[a-z0-9-]+$/;
const FORBIDDEN_KEY =
  /(?:authorization|cookie|password|secret|token|phoneNumber|url)/i;
const WHATSAPP_ID = /(?:@s\.whatsapp\.net|@g\.us|@lid|@c\.us)$/i;
const SYNTHETIC_WHATSAPP_ID =
  /^(?:0{12,18}(?:-0{10})?)@(?:s\.whatsapp\.net|g\.us|lid|c\.us)$/i;
const ADAPTERS = ["message", "chat", "connection"] as const;

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
  if (typeof value === "string") {
    if (/bearer\s+/i.test(value)) {
      throw new Error(`Replay fixture insegura em ${location}`);
    }
    if (WHATSAPP_ID.test(value) && !SYNTHETIC_WHATSAPP_ID.test(value)) {
      throw new Error(`Replay fixture exige JID/LID sintetico em ${location}`);
    }
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
    const adapter = request.fixture.event.adapter as
      | (typeof ADAPTERS)[number]
      | undefined;
    if (!adapter || !ADAPTERS.includes(adapter)) {
      throw new Error("Replay adapter invalido");
    }

    const syntheticId = `fixture-${request.runId}`;
    const context = {
      companyId,
      whatsappId: request.whatsappId,
      conversationId: syntheticId,
      contactId: syntheticId,
      externalTicketId: syntheticId,
      automationEpoch: 1
    };
    const raw = request.fixture.event.raw as Record<string, unknown>;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Replay raw sintetico invalido");
    }
    const observedAt = this.dependencies.now();
    let events: WhatsAppProviderEvent[];
    if (request.fixture.provider === "baileys") {
      events =
        adapter === "message"
          ? adaptBaileysMessageEvents({ ...context, raw })
          : [
              adapter === "chat"
                ? adaptBaileysChatUpdate({ ...context, raw, observedAt })
                : adaptBaileysConnectionUpdate({ ...context, raw, observedAt })
            ];
    } else {
      events =
        adapter === "message"
          ? adaptMetaMessageEvents({ ...context, raw })
          : [
              adapter === "chat"
                ? adaptMetaChatUpdate({ ...context, raw, observedAt })
                : adaptMetaConnectionUpdate({ ...context, raw, observedAt })
            ];
    }
    await this.dependencies.publish(events);
    return { accepted: true, sequence: request.sequence };
  }
}

export default WhatsAppMirrorReplayService;
