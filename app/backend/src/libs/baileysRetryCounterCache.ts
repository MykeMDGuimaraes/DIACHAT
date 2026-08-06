/**
 * Cache limitado do contador de retry de mensagens Baileys (Hardening T8).
 *
 * Antes: `new NodeCache()` sem TTL nem tamanho máximo — crescia sem limite
 * junto com o tráfego da sessão. Agora: TTL por entrada e tamanho máximo com
 * evicção do mais antigo (ordem de inserção do Map).
 *
 * O descarte por substituição de geração é estrutural: o wbot cria uma
 * instância por socket dentro de createWASocket, então um replace de geração
 * derruba o socket e o cache inteiro vai junto (nenhum estado migra entre
 * gerações).
 *
 * A forma da API (get/set/del/flushAll) espelha o CacheStore que o Baileys
 * 6.7.24 espera em msgRetryCounterCache.
 */

export const MSG_RETRY_CACHE_TTL_MS = 10 * 60 * 1000;
export const MSG_RETRY_CACHE_MAX_KEYS = 1000;

class BoundedTtlCache {
  private readonly store = new Map<
    string,
    { value: unknown; expiresAt: number }
  >();

  // Parameter properties keep limits injectable in tests.
  // eslint-disable-next-line no-useless-constructor
  constructor(
    private readonly ttlMs: number = MSG_RETRY_CACHE_TTL_MS,
    private readonly maxKeys: number = MSG_RETRY_CACHE_MAX_KEYS
  ) {}

  get<T = unknown>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set(key: string, value: unknown): void {
    // Re-set de chave existente não conta como crescimento.
    if (!this.store.has(key) && this.store.size >= this.maxKeys) {
      // Map preserva ordem de inserção: a primeira chave é a mais antiga.
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  del(key: string): void {
    this.store.delete(key);
  }

  flushAll(): void {
    this.store.clear();
  }

  /** Diagnóstico/testes: quantidade de entradas vigentes. */
  get size(): number {
    return this.store.size;
  }
}

export const createMsgRetryCounterCache = (
  ttlMs: number = MSG_RETRY_CACHE_TTL_MS,
  maxKeys: number = MSG_RETRY_CACHE_MAX_KEYS
): BoundedTtlCache => new BoundedTtlCache(ttlMs, maxKeys);
