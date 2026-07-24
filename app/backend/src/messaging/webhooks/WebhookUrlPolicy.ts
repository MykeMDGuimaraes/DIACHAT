import { isIP } from "net";

const unsafeIpv4 = (host: string): boolean => {
  const [first, second] = host.split(".").map(Number);
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
};

export const validateWebhookUrl = (value: string): URL => {
  let url: URL;
  try {
    url = new URL(value);
  } catch (_) {
    throw new Error("URL de webhook invÃ¡lida");
  }

  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) {
    throw new Error("URL de webhook insegura");
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || (isIP(host) === 4 && unsafeIpv4(host))) {
    throw new Error("Destino de webhook privado");
  }
  return url;
};
