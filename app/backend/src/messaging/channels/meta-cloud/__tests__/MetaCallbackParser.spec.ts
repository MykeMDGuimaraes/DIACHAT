import { parseMetaCallback } from "../MetaCallbackParser";

describe("parseMetaCallback", () => {
  it("normalizes inbound text messages and delivery status callbacks", () => {
    const result = parseMetaCallback({
      entry: [{
        changes: [{
          value: {
            contacts: [{ wa_id: "5511999999999", profile: { name: "Marco" } }],
            messages: [{ id: "wamid.in", from: "5511999999999", timestamp: "1721822400", type: "text", text: { body: "OlÃ¡" } }],
            statuses: [{ id: "wamid.out", status: "delivered", timestamp: "1721822401", recipient_id: "5511988888888" }]
          }
        }]
      }]
    });

    expect(result.messages).toEqual([expect.objectContaining({
      providerMessageId: "wamid.in",
      sender: "5511999999999",
      senderName: "Marco",
      kind: "text",
      body: "OlÃ¡"
    })]);
    expect(result.statuses).toEqual([expect.objectContaining({
      providerMessageId: "wamid.out",
      status: "delivered",
      ack: 3
    })]);
  });

  it("normalizes supported media metadata without downloading it in the parser", () => {
    const result = parseMetaCallback({
      entry: [{ changes: [{ value: { messages: [{
        id: "wamid.media",
        from: "5511999999999",
        type: "image",
        image: { id: "media_1", mime_type: "image/jpeg", caption: "foto" }
      }] } }] }]
    });

    expect(result.messages[0]).toMatchObject({
      kind: "image",
      mediaId: "media_1",
      mimeType: "image/jpeg",
      body: "foto"
    });
  });
});
