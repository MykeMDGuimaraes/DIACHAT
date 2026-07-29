import fs from "fs";
import path from "path";
import {
  adaptBaileysChatUpdate,
  adaptBaileysConnectionUpdate,
  adaptBaileysMessageEvents
} from "../../adapters/baileys/BaileysProviderEventAdapter";
import {
  adaptMetaChatUpdate,
  adaptMetaConnectionUpdate,
  adaptMetaMessageEvents
} from "../../adapters/meta-cloud/MetaProviderEventAdapter";
import { WhatsAppProviderEvent } from "../../domain/WhatsAppProviderEvent";
import WhatsAppMirrorProjectionService from "../WhatsAppMirrorProjectionService";

const fixtureRoot = path.resolve(
  __dirname,
  "../../../../fixtures/whatsapp-mirror"
);
const observedAt = new Date("2026-01-01T00:00:00.000Z");
const context = {
  companyId: 7,
  whatsappId: 3,
  conversationId: "fixture-conversation",
  contactId: "fixture-contact",
  externalTicketId: "fixture-ticket",
  automationEpoch: 3
};

const adapt = (fixture: any, item: any): WhatsAppProviderEvent[] => {
  const input = { ...context, raw: item.raw, observedAt };
  if (fixture.provider === "baileys") {
    if (item.adapter === "message") return adaptBaileysMessageEvents(input);
    return [
      item.adapter === "chat"
        ? adaptBaileysChatUpdate(input)
        : adaptBaileysConnectionUpdate(input)
    ];
  }
  if (item.adapter === "message") return adaptMetaMessageEvents(input);
  return [
    item.adapter === "chat"
      ? adaptMetaChatUpdate(input)
      : adaptMetaConnectionUpdate(input)
  ];
};

describe("sanitized WhatsApp mirror contract fixtures", () => {
  it.each(["baileys-rich.json", "meta-rich.json"])(
    "%s traverses the real adapter and projection with rich PII-free coverage",
    async fileName => {
      const fixture = JSON.parse(
        fs.readFileSync(path.join(fixtureRoot, fileName), "utf8")
      );
      const events = fixture.events.flatMap((item: any) =>
        adapt(fixture, item)
      );
      const projection = new WhatsAppMirrorProjectionService({
        loadMessage: async () => null,
        projectMedia: async (_companyId, _messageId) => null,
        now: () => observedAt
      });
      const snapshots = await Promise.all(
        events.map((event: WhatsAppProviderEvent, index: number) =>
          projection.buildSnapshot({
            id: `fixture-event-${index}`,
            companyId: event.companyId,
            eventType: event.eventType,
            aggregateId: event.aggregateId,
            payload: event.payload,
            createdAt: event.occurredAt,
            leaseToken: "fixture-lease"
          })
        )
      );
      const serialized = JSON.stringify(snapshots);

      expect(events.map(event => event.eventType)).toEqual(
        expect.arrayContaining([
          "message.received",
          "button.clicked",
          "message.reaction",
          "message.edited",
          "message.deleted",
          "chat.updated",
          "connection.updated"
        ])
      );
      if (fixture.provider === "baileys") {
        expect(events.map(event => event.payload.kind)).toEqual(
          expect.arrayContaining([
            "conversation",
            "imageMessage",
            "audioMessage",
            "videoMessage",
            "documentMessage",
            "locationMessage"
          ])
        );
      }
      const messages = snapshots.map(
        snapshot => snapshot.envelope.data.message
      );
      expect(messages.some(message => message.media?.type === "image")).toBe(
        true
      );
      expect(messages.some(message => message.media?.type === "audio")).toBe(
        true
      );
      expect(messages.some(message => message.media?.type === "video")).toBe(
        true
      );
      expect(messages.some(message => message.media?.type === "document")).toBe(
        true
      );
      expect(messages.some(message => message.location)).toBe(true);
      expect(messages.some(message => message.contacts)).toBe(true);
      expect(messages.some(message => message.poll)).toBe(true);
      expect(messages.some(message => message.quoted)).toBe(true);
      expect(
        snapshots.every(
          snapshot => snapshot.envelope.schema === "whatsapp-mirror/1"
        )
      ).toBe(true);
      expect(serialized).not.toContain('"raw"');
      expect(serialized).not.toMatch(
        /access[_-]?token|authorization|cookie|password|secret|(?:[1-9]\d{10,})@/i
      );
    }
  );
});
