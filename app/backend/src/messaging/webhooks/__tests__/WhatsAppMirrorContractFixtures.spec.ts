import fs from "fs";
import path from "path";

const fixtureRoot = path.resolve(
  __dirname,
  "../../../../fixtures/whatsapp-mirror"
);

const readFixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), "utf8"));

const assertRoteadorEnvelope = (envelope: Record<string, any>) => {
  expect(Object.keys(envelope).sort()).toEqual([
    "createdAt",
    "data",
    "id",
    "type"
  ]);
  expect(envelope.id).toMatch(/^fixture-/);
  expect([
    "message.received",
    "button.clicked",
    "message.status.updated"
  ]).toContain(envelope.type);
  expect(new Date(envelope.createdAt).toISOString()).toBe(envelope.createdAt);
  expect(envelope.data).toEqual(
    expect.objectContaining({
      messageId: expect.stringMatching(/^fixture-/),
      conversationId: expect.stringMatching(/^fixture-/),
      contactId: expect.stringMatching(/^fixture-/),
      externalTicketId: expect.stringMatching(/^fixture-/),
      automationEpoch: expect.any(Number),
      actorType: expect.any(String)
    })
  );
};

describe("sanitized WhatsApp mirror contract fixtures", () => {
  it.each(["baileys-rich.json", "meta-rich.json"])(
    "%s contains rich replay inputs and Roteador-compatible envelopes without PII or secrets",
    fileName => {
      const fixture = readFixture(fileName);
      expect(fixture.events.length).toBeGreaterThanOrEqual(3);
      fixture.roteadorEnvelopes.forEach(assertRoteadorEnvelope);

      const serialized = JSON.stringify(fixture);
      expect(serialized).not.toMatch(
        /access[_-]?token|authorization|cookie|password|secret|@s\.whatsapp\.net|@c\.us/i
      );
      expect(serialized).not.toMatch(/\b55\d{10,13}\b/);
    }
  );
});
