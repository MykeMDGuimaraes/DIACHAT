import { isIP } from "net";

const unsafeIpv4 = (host: string): boolean => {
  const [first, second, third] = host.split(".").map(Number);
  return (
    first === 0 ||
    first === 10 ||
    (first === 100 && second >= 64 && second <= 127) ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && (third === 0 || third === 2)) ||
    (first === 192 && second === 168) ||
    (first === 198 &&
      (second === 18 || second === 19 || (second === 51 && third === 100))) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
};

export const validateResolvedAddress = (address: string): void => {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped) {
    validateResolvedAddress(mapped[1]);
    return;
  }
  const version = isIP(normalized);
  if (version === 4 && !unsafeIpv4(normalized)) return;
  if (version === 6) {
    const first = parseInt(normalized.split(":")[0] || "0", 16);
    const globalUnicast = first >= 0x2000 && first <= 0x3fff;
    const documentation =
      normalized.startsWith("2001:db8:") || normalized === "2001:db8::";
    if (globalUnicast && !documentation) return;
  }
  throw new Error("Destino de webhook privado ou especial");
};

export const validateWebhookUrl = (value: string): URL => {
  let url: URL;
  try {
    url = new URL(value);
  } catch (_) {
    throw new Error("URL de webhook inválida");
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !url.hostname
  ) {
    throw new Error("URL de webhook insegura");
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost") {
    throw new Error("Destino de webhook privado");
  }
  if (isIP(host)) validateResolvedAddress(host);
  return url;
};
