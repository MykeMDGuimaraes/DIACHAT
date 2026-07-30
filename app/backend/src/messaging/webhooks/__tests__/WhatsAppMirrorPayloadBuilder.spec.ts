import { createHash } from "crypto";

import WhatsAppMirrorPayloadBuilder, {
  WHATSAPP_MIRROR_ENVELOPE_BYTES,
  WhatsAppMirrorPayloadInput,
  WhatsAppMirrorUnsafePayloadError
} from "../WhatsAppMirrorPayloadBuilder";
import { canonicalJsonBytes } from "../WhatsAppMirrorCanonical";

const baseInput = (): WhatsAppMirrorPayloadInput => ({
  eventType: "message.received",
  occurredAt: "2026-07-29T12:34:56.789Z",
  identity: {
    companyId: 7,
    aggregateId: "message-1",
    revision: "received"
  },
  correlation: {
    messageId: "message-1",
    whatsappId: 42,
    conversationId: "conversation-1",
    contactId: "contact-1",
    externalTicketId: "ticket-1",
    automationEpoch: 8,
    actorType: "contact",
    kind: "text",
    origin: "provider"
  },
  provider: {
    name: "baileys",
    eventId: "provider-event-1",
    messageId: "provider-message-1",
    timestamp: "2026-07-29T12:34:56.000Z"
  },
  connection: {
    id: 42,
    publicId: "connection-public-1",
    state: "connected",
    phoneNumber: "5511999999999"
  },
  contact: {
    id: "contact-1",
    jid: "5511988887777@s.whatsapp.net",
    lid: null,
    phoneNumber: "5511988887777",
    name: "Contato",
    pushName: "Contato WA",
    isBusiness: false
  },
  conversation: {
    id: "conversation-1",
    externalTicketId: "ticket-1",
    automationEpoch: 8,
    status: "open"
  },
  chat: {
    jid: "5511988887777@s.whatsapp.net",
    lid: null,
    type: "direct",
    name: null,
    archived: false,
    pinned: false,
    mutedUntil: null,
    unreadCount: 1
  },
  message: {
    id: "message-1",
    providerMessageId: "provider-message-1",
    direction: "in",
    fromMe: false,
    type: "text",
    text: "olá",
    timestamp: "2026-07-29T12:34:56.000Z",
    status: "received"
  }
});

describe("WhatsAppMirrorPayloadBuilder", () => {
  it("builds a serialized snapshot with canonical rawBody and its SHA-256", () => {
    const snapshot = new WhatsAppMirrorPayloadBuilder().buildSnapshot(
      baseInput()
    );

    expect(snapshot.rawBody).toBe(
      canonicalJsonBytes(snapshot.envelope).toString("utf8")
    );
    expect(snapshot.rawBody.startsWith('{"createdAt":')).toBe(true);
    expect(snapshot.bodySha256).toBe(
      createHash("sha256")
        .update(Buffer.from(snapshot.rawBody, "utf8"))
        .digest("hex")
    );
    expect(snapshot.bodySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(snapshot.rawBody)).not.toHaveProperty("bodySha256");
  });

  it("builds the whatsapp-mirror/1 structure while retaining every v1.1 correlation field", () => {
    const payload = new WhatsAppMirrorPayloadBuilder().build(baseInput());

    expect(payload).toMatchObject({
      schema: "whatsapp-mirror/1",
      type: "message.received",
      createdAt: "2026-07-29T12:34:56.789Z",
      data: {
        messageId: "message-1",
        whatsappId: 42,
        conversationId: "conversation-1",
        contactId: "contact-1",
        externalTicketId: "ticket-1",
        automationEpoch: 8,
        actorType: "contact",
        kind: "text",
        origin: "provider",
        provider: {
          name: "baileys",
          eventId: "provider-event-1",
          messageId: "provider-message-1",
          timestamp: "2026-07-29T12:34:56.000Z"
        },
        connection: {
          id: 42,
          publicId: "connection-public-1",
          state: "connected",
          phoneNumber: "5511999999999"
        },
        contact: {
          id: "contact-1",
          jid: "5511988887777@s.whatsapp.net",
          lid: null,
          phoneNumber: "5511988887777",
          name: "Contato",
          pushName: "Contato WA",
          isBusiness: false
        },
        conversation: {
          id: "conversation-1",
          externalTicketId: "ticket-1",
          automationEpoch: 8,
          status: "open"
        },
        chat: {
          jid: "5511988887777@s.whatsapp.net",
          lid: null,
          type: "direct",
          name: null,
          archived: false,
          pinned: false,
          mutedUntil: null,
          unreadCount: 1
        },
        message: expect.objectContaining({
          id: "message-1",
          providerMessageId: "provider-message-1",
          direction: "in",
          fromMe: false,
          type: "text",
          text: "olá",
          timestamp: "2026-07-29T12:34:56.000Z",
          status: "received",
          quoted: null,
          reaction: null,
          interactive: null,
          media: null,
          location: null,
          contacts: null,
          poll: null,
          edit: null,
          delete: null
        }),
        truncated: false
      }
    });
    expect(payload.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("derives a stable UUIDv5 identity from the provider-neutral event identity", () => {
    const builder = new WhatsAppMirrorPayloadBuilder();

    const first = builder.build(baseInput());
    const repeated = builder.build(baseInput());
    const changed = builder.build({
      ...baseInput(),
      identity: { ...baseInput().identity, revision: "edited-1" }
    });

    expect(repeated.id).toBe(first.id);
    expect(changed.id).not.toBe(first.id);
  });

  it("normalizes every rich message block identically for provider parity", () => {
    const builder = new WhatsAppMirrorPayloadBuilder();
    const richMessage = {
      ...baseInput().message,
      quoted: {
        id: "quoted-1",
        providerMessageId: "provider-quoted-1",
        participant: "5511988887777@s.whatsapp.net",
        type: "text",
        text: "mensagem citada"
      },
      reaction: {
        emoji: "👍",
        targetMessageId: "message-0",
        removed: false
      },
      interactive: {
        type: "button",
        id: "confirmar:1",
        title: "Confirmar",
        description: undefined
      },
      media: {
        type: "image",
        mimeType: "image/jpeg",
        fileName: "foto.jpg",
        sizeBytes: 1234,
        sha256: "abc123",
        url: "/api/v1/webhook-media/message-1",
        available: true,
        caption: "legenda"
      },
      location: {
        latitude: -23.55052,
        longitude: -46.633308,
        name: "São Paulo",
        address: "Centro",
        url: null
      },
      contacts: [
        {
          displayName: "Maria",
          vcard: "BEGIN:VCARD\nFN:Maria\nEND:VCARD",
          phoneNumbers: ["5511977776666", undefined as unknown as string]
        }
      ],
      poll: {
        name: "Escolha",
        options: ["A", "B"],
        selectedOptionIds: ["B"],
        multipleAnswers: false
      },
      edit: {
        targetMessageId: "message-0",
        text: "texto corrigido",
        editedAt: "2026-07-29T12:35:00.000Z"
      },
      delete: {
        targetMessageId: "message-old",
        deletedAt: "2026-07-29T12:36:00.000Z",
        forEveryone: true
      }
    };
    const baileys = builder.build({ ...baseInput(), message: richMessage });
    const meta = builder.build({
      ...baseInput(),
      provider: { ...baseInput().provider, name: "meta-cloud" },
      message: richMessage
    });

    expect(baileys.data.message).toEqual({
      ...richMessage,
      contacts: [
        {
          displayName: "Maria",
          vcard: "BEGIN:VCARD\nFN:Maria\nEND:VCARD",
          phoneNumbers: ["5511977776666", null]
        }
      ],
      interactive: {
        type: "button",
        id: "confirmar:1",
        title: "Confirmar",
        description: null
      }
    });
    expect(meta.data.message).toEqual(baileys.data.message);
    expect(meta.data.provider.name).toBe("meta-cloud");
    expect(baileys.data.provider.name).toBe("baileys");
  });

  it("rejects forbidden secret-bearing keys recursively before projection", () => {
    const input = baseInput() as WhatsAppMirrorPayloadInput & {
      message: { media: { metadata: unknown } };
    };
    input.message.media = {
      ...input.message.media,
      metadata: { nested: { access_token: "not-safe" } }
    };

    expect(() => new WhatsAppMirrorPayloadBuilder().build(input)).toThrow(
      new WhatsAppMirrorUnsafePayloadError(
        "Forbidden key at $.message.media.metadata.nested.access_token"
      )
    );
  });

  it.each(["authToken", "sessionToken", "appSecret", "clientSecretValue"])(
    "rejects compound secret-bearing key %s inside nested arrays",
    key => {
      const input = baseInput();
      const unsafeContact = {
        displayName: null,
        vcard: null,
        phoneNumbers: null,
        metadata: { [key]: "secret-material-that-must-not-project" }
      };
      input.message.contacts = [unsafeContact];

      expect(() => new WhatsAppMirrorPayloadBuilder().build(input)).toThrow(
        new WhatsAppMirrorUnsafePayloadError(
          `Forbidden key at $.message.contacts[0].metadata.${key}`
        )
      );
    }
  );

  it("allows non-secret keyVersion metadata but does not project it publicly", () => {
    const input = baseInput();
    const providerWithKeyVersion = { ...input.provider, keyVersion: "v2" };
    input.provider = providerWithKeyVersion;

    const payload = new WhatsAppMirrorPayloadBuilder().build(input);

    expect(payload.data.provider).not.toHaveProperty("keyVersion");
  });

  it("rejects secret-shaped values even when stored under an allowed key", () => {
    const input = baseInput();
    input.message.text = "Bearer abcdefghijklmnopqrstuvwxyz";

    expect(() => new WhatsAppMirrorPayloadBuilder().build(input)).toThrow(
      new WhatsAppMirrorUnsafePayloadError("Forbidden value at $.message.text")
    );
  });

  it("truncates message and quote text on UTF-8 boundaries and marks the envelope", () => {
    const input = baseInput();
    input.message.text = `${"x".repeat(65535)}💥ignored`;
    input.message.quoted = {
      id: "quoted-1",
      providerMessageId: "provider-quoted-1",
      participant: null,
      type: "text",
      text: `${"q".repeat(4095)}💥ignored`
    };

    const payload = new WhatsAppMirrorPayloadBuilder().build(input);

    expect(Buffer.byteLength(payload.data.message.text, "utf8")).toBe(65535);
    expect(payload.data.message.text).toBe("x".repeat(65535));
    expect(Buffer.byteLength(payload.data.message.quoted.text, "utf8")).toBe(
      4095
    );
    expect(payload.data.message.quoted.text).toBe("q".repeat(4095));
    expect(payload.data.truncated).toBe(true);
  });

  it("caps the final canonical envelope at 262144 bytes and retains flat correlation keys", () => {
    const input = baseInput();
    input.message.contacts = [
      {
        displayName: "Documento",
        vcard: "v".repeat(300000),
        phoneNumbers: ["5511977776666"]
      }
    ];

    const payload = new WhatsAppMirrorPayloadBuilder().build(input);

    expect(canonicalJsonBytes(payload).byteLength).toBeLessThanOrEqual(
      WHATSAPP_MIRROR_ENVELOPE_BYTES
    );
    expect(WHATSAPP_MIRROR_ENVELOPE_BYTES).toBe(262144);
    expect(payload.data.truncated).toBe(true);
    expect(payload.data.message.contacts).toBeNull();
    expect(payload.data).toMatchObject({
      messageId: "message-1",
      whatsappId: 42,
      conversationId: "conversation-1",
      contactId: "contact-1",
      externalTicketId: "ticket-1",
      automationEpoch: 8,
      actorType: "contact",
      kind: "text",
      origin: "provider"
    });
  });

  it("prunes oversized optional content without clearing long correlations or media integrity fields", () => {
    const input = baseInput();
    const longCorrelation = "correlation-".repeat(1600);
    input.correlation = {
      messageId: `${longCorrelation}message`,
      whatsappId: 42,
      conversationId: `${longCorrelation}conversation`,
      contactId: `${longCorrelation}contact`,
      externalTicketId: `${longCorrelation}ticket`,
      automationEpoch: 8,
      actorType: `${longCorrelation}actor`,
      kind: `${longCorrelation}kind`,
      origin: `${longCorrelation}origin`
    };
    input.message.media = {
      type: "image",
      mimeType: "image/jpeg",
      fileName: "proof.jpg",
      sizeBytes: 300000,
      sha256: "a".repeat(64),
      url: "/api/v1/webhook-media/message-1",
      available: true,
      caption: "caption-".repeat(30000)
    };
    input.message.quoted = {
      id: "quoted-1",
      providerMessageId: "provider-quoted-1",
      participant: "5511988887777@s.whatsapp.net",
      type: "text",
      text: "q".repeat(4096)
    };
    input.contact.name = "name-".repeat(26000);
    input.message.contacts = [
      {
        displayName: "Oversized",
        vcard: "v".repeat(300000),
        phoneNumbers: ["5511977776666"]
      }
    ];

    const payload = new WhatsAppMirrorPayloadBuilder().build(input);

    expect(canonicalJsonBytes(payload).byteLength).toBeLessThanOrEqual(
      WHATSAPP_MIRROR_ENVELOPE_BYTES
    );
    expect(payload.data.truncated).toBe(true);
    expect(payload.data).toMatchObject(input.correlation);
    expect(payload.data.message.media).toMatchObject({
      type: "image",
      mimeType: "image/jpeg",
      sha256: "a".repeat(64),
      url: "/api/v1/webhook-media/message-1",
      available: true,
      caption: null
    });
    expect(payload.data.message.quoted).toMatchObject({
      id: "quoted-1",
      providerMessageId: "provider-quoted-1",
      participant: "5511988887777@s.whatsapp.net",
      type: "text",
      text: null
    });
    expect(payload.data.contact.phoneNumber).toBe("5511988887777");
  });

  it("fails explicitly when the protected mandatory skeleton exceeds the envelope cap", () => {
    const input = baseInput();
    const mandatoryValue = "m".repeat(40000);
    input.correlation = {
      messageId: mandatoryValue,
      whatsappId: 42,
      conversationId: mandatoryValue,
      contactId: mandatoryValue,
      externalTicketId: mandatoryValue,
      automationEpoch: 8,
      actorType: mandatoryValue,
      kind: mandatoryValue,
      origin: mandatoryValue
    };
    input.message.contacts = [
      {
        displayName: "Optional",
        vcard: "v".repeat(300000),
        phoneNumbers: null
      }
    ];

    expect(() => new WhatsAppMirrorPayloadBuilder().build(input)).toThrow(
      "Mandatory WhatsApp mirror envelope exceeds 262144 bytes"
    );
  });
});
