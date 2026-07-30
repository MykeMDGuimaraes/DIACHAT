import { createHash } from "crypto";
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
const REPLAY_EPOCH_SECONDS = 1_767_225_600;

interface ReplayDependencies {
  publish(events: readonly WhatsAppProviderEvent[]): Promise<void>;
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
  publish: events => defaultPublisher.publish(events)
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

const replayIdentity = (runId: string, sequence: number) => {
  const digest = createHash("sha256")
    .update(`${runId}:${sequence}`)
    .digest("hex");
  const runOffsetSeconds =
    parseInt(createHash("sha256").update(runId).digest("hex").slice(0, 8), 16) %
    31_536_000;
  const timestampSeconds = REPLAY_EPOCH_SECONDS + runOffsetSeconds + sequence;
  return {
    sourceEventId: `capacity-${digest.slice(0, 32)}`,
    timestampSeconds,
    observedAt: new Date(timestampSeconds * 1000)
  };
};

const materializeReplayRaw = (
  provider: ReplayRequest["fixture"]["provider"],
  adapter: (typeof ADAPTERS)[number],
  rawInput: Record<string, unknown>,
  runId: string,
  sequence: number
): { raw: Record<string, unknown>; observedAt: Date } => {
  const raw = JSON.parse(JSON.stringify(rawInput)) as Record<string, any>;
  const identity = replayIdentity(runId, sequence);
  if (provider === "baileys") {
    raw.eventId = identity.sourceEventId;
    raw.timestamp = identity.timestampSeconds;
    raw.conversationTimestamp = identity.timestampSeconds;
    if (adapter === "message") {
      raw.key = { ...(raw.key || {}), id: identity.sourceEventId };
      raw.messageTimestamp = identity.timestampSeconds;
    }
  } else {
    raw.source_id = identity.sourceEventId;
    raw.timestamp = String(identity.timestampSeconds);
    if (adapter === "message") raw.id = identity.sourceEventId;
  }
  return { raw, observedAt: identity.observedAt };
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
    const rawInput = request.fixture.event.raw as Record<string, unknown>;
    if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
      throw new Error("Replay raw sintetico invalido");
    }
    const { raw, observedAt } = materializeReplayRaw(
      request.fixture.provider,
      adapter,
      rawInput,
      request.runId,
      request.sequence
    );
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
    // Interactive adapters also emit message.received. Replaying only the
    // most specialized event preserves one persisted outbox event per request.
    await this.dependencies.publish([events[events.length - 1]]);
    return { accepted: true, sequence: request.sequence };
  }
}

export default WhatsAppMirrorReplayService;
