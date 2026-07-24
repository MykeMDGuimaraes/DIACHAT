import MetaGraphApiClient from "../MetaGraphApiClient";

describe("MetaGraphApiClient", () => {
  it("validates the company app, number and WABA through the real Graph API contract", async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce({ data: { data: { is_valid: true, app_id: "app_1" } } })
      .mockResolvedValueOnce({ data: { id: "phone_1", display_phone_number: "+55 11 99999-9999" } })
      .mockResolvedValueOnce({ data: { data: [{ id: "phone_1" }] } });
    const client = new MetaGraphApiClient(
      { graphVersion: "v23.0", apiBaseUrl: "https://graph.facebook.com" },
      { request }
    );

    await expect(
      client.validateConnection({
        appId: "app_1",
        appSecret: "app-secret",
        accessToken: "access-token",
        wabaId: "waba_1",
        phoneNumberId: "phone_1"
      })
    ).resolves.toEqual({ displayPhoneNumber: "+55 11 99999-9999" });

    expect(request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: "GET",
        path: "/v23.0/debug_token",
        accessToken: "app_1|app-secret",
        query: { input_token: "access-token" }
      })
    );
    expect(request).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        path: "/v23.0/waba_1/phone_numbers"
      })
    );
  });

  it("rejects a phone number that is not attached to the submitted WABA", async () => {
    const client = new MetaGraphApiClient(
      { graphVersion: "v23.0", apiBaseUrl: "https://graph.facebook.com" },
      {
        request: jest
          .fn()
          .mockResolvedValueOnce({ data: { data: { is_valid: true, app_id: "app_1" } } })
          .mockResolvedValueOnce({ data: { id: "phone_1" } })
          .mockResolvedValueOnce({ data: { data: [{ id: "other_phone" }] } })
      }
    );

    await expect(
      client.validateConnection({
        appId: "app_1",
        appSecret: "app-secret",
        accessToken: "access-token",
        wabaId: "waba_1",
        phoneNumberId: "phone_1"
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("sends a text message through the submitted phone number", async () => {
    const request = jest.fn().mockResolvedValue({ data: { messages: [{ id: "wamid.1" }] } });
    const client = new MetaGraphApiClient(
      { graphVersion: "v23.0", apiBaseUrl: "https://graph.facebook.com" },
      { request }
    );

    await expect(
      client.sendText({
        phoneNumberId: "phone_1",
        accessToken: "access-token",
        recipient: "5511999999999",
        text: "OlÃ¡"
      })
    ).resolves.toEqual({ providerMessageId: "wamid.1" });

    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/v23.0/phone_1/messages",
      accessToken: "access-token",
      body: {
        messaging_product: "whatsapp",
        to: "5511999999999",
        type: "text",
        text: { body: "OlÃ¡", preview_url: false }
      }
    });
  });

  it("sends media and template commands using their dedicated Graph payloads", async () => {
    const request = jest.fn().mockResolvedValue({ data: { messages: [{ id: "wamid.2" }] } });
    const client = new MetaGraphApiClient(
      { graphVersion: "v23.0", apiBaseUrl: "https://graph.facebook.com" },
      { request }
    );

    await client.sendMessage({
      phoneNumberId: "phone_1",
      accessToken: "access-token",
      recipient: "5511999999999",
      kind: "image",
      payload: { link: "https://cdn.example.com/photo.jpg", caption: "Foto" }
    });
    await client.sendMessage({
      phoneNumberId: "phone_1",
      accessToken: "access-token",
      recipient: "5511999999999",
      kind: "template",
      payload: { name: "pedido_pronto", language: "pt_BR", components: [] }
    });

    expect(request).toHaveBeenNthCalledWith(1, expect.objectContaining({
      body: expect.objectContaining({
        type: "image",
        image: { link: "https://cdn.example.com/photo.jpg", caption: "Foto" }
      })
    }));
    expect(request).toHaveBeenNthCalledWith(2, expect.objectContaining({
      body: expect.objectContaining({
        type: "template",
        template: { name: "pedido_pronto", language: { code: "pt_BR" }, components: [] }
      })
    }));
  });
});
