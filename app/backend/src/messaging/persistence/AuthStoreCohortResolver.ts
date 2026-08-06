import MessagingRolloutCohort from "./models/MessagingRolloutCohort";
import { resolveAuthStoreMode, SessionKeyStoreMode } from "./authStoreMode";

export const AUTH_STORE_COHORT_CAPABILITY = "auth_store";

// Cache curto por empresa: o modo é consultado a cada criação de socket
// (boot/conexão); 60s evita um SELECT por evento de auth-state sem prender o
// operador a mudanças de coorte por mais de um minuto.
const COHORT_CACHE_TTL_MS = 60_000;

type CohortCacheEntry = { mode: SessionKeyStoreMode; expiresAt: number };

const cohortCache = new Map<number, CohortCacheEntry>();

const toMode = (raw: unknown): SessionKeyStoreMode | null =>
  raw === "json" || raw === "dual_write" || raw === "postgres" ? raw : null;

/**
 * Modo do auth store para uma empresa: coorte persistida vence o default
 * global (env). Qualquer falha (DB indisponível, migração pendente, modo
 * desconhecido, companyId ausente) cai no modo global — nunca quebra o boot.
 */
export const resolveAuthStoreModeForCompany = async (
  companyId: number | null | undefined,
  environment: Record<string, string | undefined> = process.env
): Promise<SessionKeyStoreMode> => {
  const fallback = resolveAuthStoreMode(environment);
  if (typeof companyId !== "number" || !Number.isFinite(companyId)) {
    return fallback;
  }
  const now = Date.now();
  const cached = cohortCache.get(companyId);
  if (cached && cached.expiresAt > now) {
    return cached.mode;
  }
  try {
    const cohort = await MessagingRolloutCohort.findOne({
      where: { capability: AUTH_STORE_COHORT_CAPABILITY, companyId }
    });
    const mode = toMode(cohort?.mode) ?? fallback;
    cohortCache.set(companyId, { mode, expiresAt: now + COHORT_CACHE_TTL_MS });
    return mode;
  } catch {
    // Coorte indisponível (ex.: tabela ainda não migrada): modo global.
    return fallback;
  }
};

/** Limpa o cache de coortes (testes e troca operacional imediata). */
export const flushAuthStoreCohortCache = (): void => {
  cohortCache.clear();
};
