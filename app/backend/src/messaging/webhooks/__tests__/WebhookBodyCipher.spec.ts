import {
  decryptWebhookBody,
  encryptWebhookBody,
  WebhookBodyBinding
} from "../WebhookBodyCipher";

const keyring = {
  activeKeyId: "v2",
  keys: {
    v1: Buffer.alloc(32, 1).toString("base64"),
    v2: Buffer.alloc(32, 2).toString("base64")
  }
};

const binding: WebhookBodyBinding = {
  companyId: 7,
  subscriptionId: "sub_1",
  deliveryId: "del_1",
  eventId: "evt_1"
};

describe("WebhookBodyCipher", () => {
  it("encrypts and authenticates the exact immutable raw body bytes", () => {
    const rawBody = Buffer.from(
      '{"schema":"whatsapp-mirror/1","text":"olá 🚚"}',
      "utf8"
    );

    const encrypted = encryptWebhookBody(rawBody, binding, keyring);

    expect(encrypted).toEqual({
      bodyCiphertext: expect.any(String),
      bodyKeyVersion: "v2",
      bodySha256:
        "b592ed2cbad275a0e79c73e67a2d239e6c1390436d684419c50d8bc6b68dcf72"
    });
    expect(
      decryptWebhookBody(encrypted, binding, keyring).equals(rawBody)
    ).toBe(true);
  });

  it.each([
    ["company", { companyId: 8 }],
    ["subscription", { subscriptionId: "sub_2" }],
    ["delivery", { deliveryId: "del_2" }],
    ["event", { eventId: "evt_2" }]
  ])("rejects a %s AAD mismatch", (_name, changes) => {
    const encrypted = encryptWebhookBody(
      Buffer.from('{"id":"evt_1"}'),
      binding,
      keyring
    );

    expect(() =>
      decryptWebhookBody(encrypted, { ...binding, ...changes }, keyring)
    ).toThrow("Corpo de webhook inválido");
  });

  it("rejects ciphertext or digest tampering", () => {
    const encrypted = encryptWebhookBody(
      Buffer.from('{"id":"evt_1"}'),
      binding,
      keyring
    );

    expect(() =>
      decryptWebhookBody(
        {
          ...encrypted,
          bodyCiphertext: `${encrypted.bodyCiphertext}A`
        },
        binding,
        keyring
      )
    ).toThrow("Corpo de webhook inválido");
    expect(() =>
      decryptWebhookBody(
        {
          ...encrypted,
          bodySha256: "0".repeat(64)
        },
        binding,
        keyring
      )
    ).toThrow("Corpo de webhook inválido");
  });
});
