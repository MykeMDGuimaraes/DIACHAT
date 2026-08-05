import axios from "axios";
import dns from "dns";
import fs from "fs";
import https from "https";
import net from "net";
import os from "os";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import AppError from "../../errors/AppError";
import { stageMessagingMedia } from "./persistMessagingUpload";

/**
 * Downloader controlado de midia remota (anti-SSRF).
 *
 * URLs de midia podem vir de fluxos Typebot/providers — conteudo potencial-
 * mente hostil. Antes de qualquer fetch: HTTPS obrigatorio, hostname nao
 * interno, e TODOS os enderecos resolvidos via DNS precisam ser publicos.
 * A conexao usa um agente HTTPS com lookup pinado nos enderecos ja validados
 * (sem re-resolucao), e cada redirect e revalidado do zero. O Baileys nunca
 * recebe a URL: o conteudo e baixado com limites de tamanho/tempo e staged
 * em disco (localPath "messaging/<arquivo>").
 */

const MAX_REDIRECTS = 3;
const MAX_BYTES = 64 * 1024 * 1024; // 64MB
const TIMEOUT_MS = 30000;

const BLOCKED_HOSTNAME_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home",
  ".corp"
];

const isPrivateIpv4 = (address: string): boolean => {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some(part => Number.isNaN(part) || part < 0 || part > 255)
  ) {
    return true; // malformado → conservador
  }
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 169 && b === 254) return true; // link-local (metadata cloud)
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 + 192.0.2.0/24
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
  if (a === 198 && b === 51 && c === 100) return true; // doc
  if (a === 203 && b === 0 && c === 113) return true; // doc
  if (a >= 224) return true; // multicast/reservado/broadcast
  return false;
};

const isPublicIp = (address: string, family: number): boolean => {
  if (family === 4) {
    return !isPrivateIpv4(address);
  }
  const normalized = address.toLowerCase();
  const mapped = normalized.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) {
    return !isPrivateIpv4(mapped[1]);
  }
  if (normalized.includes(".")) return false; // outra forma embeddada
  if (normalized === "::" || normalized === "::1") return false;
  const first = parseInt(normalized.split(":")[0] || "0", 16);
  if (Number.isNaN(first) || first === 0) return false;
  if (first >= 0xfc00 && first <= 0xfdff) return false; // unique local
  if (first >= 0xfe80 && first <= 0xfebf) return false; // link-local
  if (first >= 0xff00) return false; // multicast
  return true;
};

const assertSafeHostname = (hostname: string): void => {
  if (
    !hostname ||
    hostname === "localhost" ||
    !hostname.includes(".") ||
    BLOCKED_HOSTNAME_SUFFIXES.some(suffix => hostname.endsWith(suffix))
  ) {
    throw new AppError("Host de midia remota nao permitido", 400);
  }
};

const resolvePublicAddresses = async (
  hostname: string
): Promise<dns.LookupAddress[]> => {
  const literalFamily = net.isIP(hostname);
  if (literalFamily) {
    if (!isPublicIp(hostname, literalFamily)) {
      throw new AppError("Host de midia remota nao permitido", 400);
    }
    return [{ address: hostname, family: literalFamily }];
  }
  const addresses = await dns.promises
    .lookup(hostname, { all: true, verbatim: true })
    .catch(() => [] as dns.LookupAddress[]);
  if (!addresses.length) {
    throw new AppError("Host de midia remota nao resolvido", 400);
  }
  // TODOS os enderecos precisam ser publicos — um unico A/AAAA privado
  // invalida o host (mitiga rebinding dentro de uma mesma resolucao).
  addresses.forEach(entry => {
    if (!isPublicIp(entry.address, entry.family)) {
      throw new AppError("Host de midia remota nao permitido", 400);
    }
  });
  return addresses;
};

// Agente com lookup pinado: a conexao usa exatamente os enderecos ja
// validados — sem segunda resolucao DNS (TOCTOU). Node >= 18 chama lookup
// com all=true esperando um ARRAY; retorno unico quebra a conexao.
const pinnedAgent = (addresses: dns.LookupAddress[]): https.Agent =>
  new https.Agent({
    lookup: (_hostname, options, callback) => {
      if ((options as dns.LookupOptions).all === true) {
        // Node >= 18 chama lookup com all=true esperando ARRAY; a tipagem do
        // Agent so conhece a forma single-address — cast deliberado.
        (
          callback as unknown as (
            err: NodeJS.ErrnoException | null,
            resolvedAddresses: dns.LookupAddress[]
          ) => void
        )(null, addresses);
        return;
      }
      const first = addresses[0];
      callback(null, first.address, first.family);
    }
  });

const streamToFileWithCap = (
  stream: NodeJS.ReadableStream,
  target: string,
  maxBytes: number
): Promise<void> =>
  new Promise((resolve, reject) => {
    let settled = false;
    let total = 0;
    const out = fs.createWriteStream(target, { mode: 0o600 });
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      out.destroy();
      reject(err);
    };
    stream.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        (stream as fs.ReadStream).destroy();
        fail(new AppError("Midia remota excede o tamanho maximo", 400));
      }
    });
    stream.on("error", fail);
    out.on("error", fail);
    out.on("finish", () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    stream.pipe(out);
  });

/**
 * Baixa uma midia remota de forma segura e a persiste no storage privado.
 * @returns localPath relativo ("messaging/<arquivo>") pronto para o adapter.
 */
export const fetchRemoteMediaSecurely = async (
  rawUrl: string,
  originalName?: string
): Promise<string> => {
  let current = rawUrl;
  for (let redirects = 0; ; redirects += 1) {
    let url: URL;
    try {
      url = new URL(current);
    } catch {
      throw new AppError("URL de midia invalida", 400);
    }
    if (url.protocol !== "https:") {
      throw new AppError("URL de midia remota deve ser HTTPS", 400);
    }
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    assertSafeHostname(hostname);
    const addresses = await resolvePublicAddresses(hostname);

    const response = await axios.get(current, {
      httpsAgent: pinnedAgent(addresses),
      // Sem proxy: HTTP(S)_PROXY faria a conexao sair pelo proxy, que resolve
      // o destino por conta propria — bypass do lookup pinado (SSRF).
      proxy: false,
      responseType: "stream",
      maxRedirects: 0, // redirects sao seguidos manualmente, revalidados
      timeout: TIMEOUT_MS,
      maxContentLength: MAX_BYTES,
      validateStatus: status => status >= 200 && status < 400,
      headers: {
        "User-Agent": "diachat-media-fetcher/1.0",
        Accept: "*/*"
      }
    });

    if (response.status >= 300) {
      response.data?.destroy?.();
      if (redirects >= MAX_REDIRECTS) {
        throw new AppError(
          "URL de midia remota excedeu o limite de redirecionamentos",
          400
        );
      }
      const location = response.headers.location;
      if (typeof location !== "string" || !location) {
        throw new AppError("Redirecionamento de midia sem destino", 400);
      }
      // O proximo loop revalida protocolo, hostname e DNS do destino.
      current = new URL(location, current).toString();
    } else {
      const declared = Number(response.headers["content-length"]);
      if (Number.isFinite(declared) && declared > MAX_BYTES) {
        response.data.destroy();
        throw new AppError("Midia remota excede o tamanho maximo", 400);
      }

      const tmpPath = path.join(os.tmpdir(), `remote-media-${uuidv4()}`);
      try {
        await streamToFileWithCap(response.data, tmpPath, MAX_BYTES);
        return await stageMessagingMedia(
          tmpPath,
          originalName || path.basename(url.pathname) || "remote-media"
        );
      } finally {
        await fs.promises.unlink(tmpPath).catch(() => undefined);
      }
    }
  }
};
