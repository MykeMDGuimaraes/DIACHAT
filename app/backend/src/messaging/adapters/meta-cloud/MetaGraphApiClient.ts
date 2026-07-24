import https from "https";

import AppError from "../../../errors/AppError";
import { loadMetaGraphConfig, MetaGraphConfig } from "./MetaGraphConfig";

export interface MetaGraphRequest {
  method: "GET" | "POST";
  path: string;
  accessToken: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}

export interface MetaGraphTransport {
  request<T>(request: MetaGraphRequest): Promise<{ data: T }>;
}

export interface MetaConnectionInput {
  appId: string;
  appSecret: string;
  accessToken: string;
  wabaId: string;
  phoneNumberId: string;
  graphVersion?: string;
}

export interface MetaConnectionValidation {
  displayPhoneNumber?: string;
}

export interface MetaTextMessageInput {
  phoneNumberId: string;
  accessToken: string;
  recipient: string;
  text: string;
  graphVersion?: string;
}

export type MetaMessageKind = "text" | "image" | "audio" | "video" | "document" | "template";

export interface MetaMessageInput {
  phoneNumberId: string;
  accessToken: string;
  recipient: string;
  kind: MetaMessageKind;
  payload: Record<string, any>;
  graphVersion?: string;
}

interface MetaDebugTokenResponse {
  data?: {
    is_valid?: boolean;
    app_id?: string;
  };
}

interface MetaPhoneNumberResponse {
  id?: string;
  display_phone_number?: string;
}

interface MetaWabaPhoneNumbersResponse {
  data?: Array<{ id?: string }>;
}

interface MetaSendMessageResponse {
  messages?: Array<{ id?: string }>;
}

interface MetaMediaMetadataResponse {
  url?: string;
  mime_type?: string;
}

class HttpsMetaGraphTransport implements MetaGraphTransport {
  private readonly apiBaseUrl: string;

  constructor(apiBaseUrl: string) {
    this.apiBaseUrl = apiBaseUrl;
  }

  request<T>(request: MetaGraphRequest): Promise<{ data: T }> {
    const url = new URL(request.path, this.apiBaseUrl);
    Object.entries(request.query || {}).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    const payload = request.body ? JSON.stringify(request.body) : undefined;

    return new Promise((resolve, reject) => {
      const remoteRequest = https.request(
        url,
        {
          method: request.method,
          headers: {
            Authorization: `Bearer ${request.accessToken}`,
            Accept: "application/json",
            ...(payload
              ? {
                  "Content-Type": "application/json",
                  "Content-Length": Buffer.byteLength(payload)
                }
              : {})
          }
        },
        response => {
          const chunks: Buffer[] = [];
          response.on("data", chunk => chunks.push(Buffer.from(chunk)));
          response.on("end", () => {
            const rawBody = Buffer.concat(chunks).toString("utf8");
            if (response.statusCode && (response.statusCode < 200 || response.statusCode >= 300)) {
              reject(new AppError("Falha na comunicaÃ§Ã£o com a Meta", 502));
              return;
            }

            try {
              resolve({ data: rawBody ? (JSON.parse(rawBody) as T) : ({} as T) });
            } catch (_error) {
              reject(new AppError("Resposta invÃ¡lida da Meta", 502));
            }
          });
        }
      );

      remoteRequest.on("error", () => reject(new AppError("Falha na comunicaÃ§Ã£o com a Meta", 502)));
      if (payload) {
        remoteRequest.write(payload);
      }
      remoteRequest.end();
    });
  }
}

class MetaGraphApiClient {
  private readonly config: MetaGraphConfig;

  private readonly transport: MetaGraphTransport;

  constructor(
    config: MetaGraphConfig = loadMetaGraphConfig(),
    transport: MetaGraphTransport = new HttpsMetaGraphTransport(config.apiBaseUrl)
  ) {
    this.config = config;
    this.transport = transport;
  }

  async validateConnection(
    input: MetaConnectionInput
  ): Promise<MetaConnectionValidation> {
    const graphVersion = input.graphVersion || this.config.graphVersion;
    if (!/^v\d+\.\d+$/.test(graphVersion)) {
      throw new AppError("Versao Graph invalida", 400);
    }
    const appAccessToken = `${input.appId}|${input.appSecret}`;
    const debugToken = await this.transport.request<MetaDebugTokenResponse>({
      method: "GET",
      path: `/${graphVersion}/debug_token`,
      accessToken: appAccessToken,
      query: { input_token: input.accessToken }
    });

    if (
      !debugToken.data.data?.is_valid ||
      String(debugToken.data.data.app_id) !== input.appId
    ) {
      throw new AppError("Token Meta invÃ¡lido para este aplicativo", 400);
    }

    const phoneNumber = await this.transport.request<MetaPhoneNumberResponse>({
      method: "GET",
      path: `/${graphVersion}/${input.phoneNumberId}`,
      accessToken: input.accessToken,
      query: { fields: "id,display_phone_number" }
    });

    if (phoneNumber.data.id !== input.phoneNumberId) {
      throw new AppError("NÃºmero Meta invÃ¡lido", 400);
    }

    const wabaPhoneNumbers = await this.transport.request<MetaWabaPhoneNumbersResponse>({
      method: "GET",
      path: `/${graphVersion}/${input.wabaId}/phone_numbers`,
      accessToken: input.accessToken,
      query: { fields: "id" }
    });

    const belongsToWaba = (wabaPhoneNumbers.data.data || []).some(
      phone => phone.id === input.phoneNumberId
    );
    if (!belongsToWaba) {
      throw new AppError("O nÃºmero nÃ£o pertence Ã  conta WhatsApp Business informada", 400);
    }

    return { displayPhoneNumber: phoneNumber.data.display_phone_number };
  }

  async sendText(input: MetaTextMessageInput): Promise<{ providerMessageId?: string }> {
    return this.sendMessage({
      ...input,
      kind: "text",
      payload: { text: input.text }
    });
  }

  async sendMessage(input: MetaMessageInput): Promise<{ providerMessageId?: string }> {
    const graphVersion = input.graphVersion || this.config.graphVersion;
    if (!/^v\d+\.\d+$/.test(graphVersion)) {
      throw new AppError("Versao Graph invalida", 400);
    }
    let content: Record<string, unknown>;
    if (input.kind === "text") {
      content = { body: input.payload.text, preview_url: false };
    } else if (input.kind === "template") {
      content = {
        name: input.payload.name,
        language: { code: input.payload.language },
        components: input.payload.components || []
      };
    } else {
      content = {
        link: input.payload.link,
        ...(input.payload.caption ? { caption: input.payload.caption } : {}),
        ...(input.kind === "document" && input.payload.fileName
          ? { filename: input.payload.fileName }
          : {})
      };
    }
    const response = await this.transport.request<MetaSendMessageResponse>({
      method: "POST",
      path: `/${graphVersion}/${input.phoneNumberId}/messages`,
      accessToken: input.accessToken,
      body: {
        messaging_product: "whatsapp",
        to: input.recipient,
        type: input.kind,
        [input.kind]: content
      }
    });

    return { providerMessageId: response.data.messages?.[0]?.id };
  }

  async getMediaMetadata(input: {
    mediaId: string;
    accessToken: string;
    graphVersion?: string;
  }): Promise<{ url: string; mimeType?: string }> {
    const graphVersion = input.graphVersion || this.config.graphVersion;
    const response = await this.transport.request<MetaMediaMetadataResponse>({
      method: "GET",
      path: `/${graphVersion}/${input.mediaId}`,
      accessToken: input.accessToken
    });
    if (!response.data.url || !/^https:\/\//i.test(response.data.url)) {
      throw new AppError("URL de midia Meta invalida", 502);
    }
    return { url: response.data.url, mimeType: response.data.mime_type };
  }
}

export default MetaGraphApiClient;
