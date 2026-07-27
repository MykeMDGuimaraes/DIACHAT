import { NextFunction, Request, Response } from "express";
import Company from "../../models/Company";

interface CompanyRateLimits {
  requestsPerMinute: number;
  uploadMbPerMinute: number;
}

interface WindowUsage {
  windowStartedAt: number;
  requests: number;
  bytes: number;
}

type ResolveLimits = (companyId: number) => Promise<CompanyRateLimits>;

const defaultResolveLimits: ResolveLimits = async companyId => {
  const company = await Company.findByPk(companyId, {
    attributes: ["messagingRequestsPerMinute", "messagingUploadMbPerMinute"]
  });
  return {
    requestsPerMinute: company?.messagingRequestsPerMinute ?? 60,
    uploadMbPerMinute: company?.messagingUploadMbPerMinute ?? 100
  };
};

export const createPublicApiRateLimit = (
  resolveLimits: ResolveLimits = defaultResolveLimits,
  now: () => number = Date.now
) => {
  const usage = new Map<string, WindowUsage>();

  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void | Response> => {
    const credential = req.apiCredential;
    if (!credential) return next();

    const limits = await resolveLimits(credential.companyId);
    const currentTime = now();
    const key = credential.id;
    let current = usage.get(key);
    if (!current || currentTime - current.windowStartedAt >= 60_000) {
      current = { windowStartedAt: currentTime, requests: 0, bytes: 0 };
    }

    const declaredBytes = Number(req.headers["content-length"]);
    const bodyBytes = Number.isFinite(declaredBytes)
      ? declaredBytes
      : Buffer.byteLength(JSON.stringify(req.body || {}));
    const nextRequests = current.requests + 1;
    const nextBytes = current.bytes + (Number.isFinite(bodyBytes) ? bodyBytes : 0);
    const byteLimit = limits.uploadMbPerMinute * 1024 * 1024;
    const resetSeconds = Math.max(
      1,
      Math.ceil((current.windowStartedAt + 60_000 - currentTime) / 1000)
    );

    res.setHeader("X-RateLimit-Limit", limits.requestsPerMinute);
    res.setHeader(
      "X-RateLimit-Remaining",
      Math.max(0, limits.requestsPerMinute - nextRequests)
    );
    res.setHeader("X-RateLimit-Reset", resetSeconds);

    if (
      nextRequests > limits.requestsPerMinute ||
      nextBytes > byteLimit
    ) {
      res.setHeader("Retry-After", resetSeconds);
      return res.status(429).json({
        error: "RATE_LIMIT_EXCEEDED",
        message: "Limite por credencial excedido",
        retryAfterSeconds: resetSeconds
      });
    }

    current.requests = nextRequests;
    current.bytes = nextBytes;
    usage.set(key, current);
    return next();
  };
};

export default createPublicApiRateLimit();
