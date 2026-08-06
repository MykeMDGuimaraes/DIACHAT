import { createMsgRetryCounterCache } from "../baileysRetryCounterCache";

describe("baileysRetryCounterCache (T8)", () => {
  it("evita o mais antigo ao atingir o tamanho máximo", () => {
    const cache = createMsgRetryCounterCache(60_000, 3);

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.set("d", 4); // excede: "a" sai

    expect(cache.size).toBe(3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("d")).toBe(4);
  });

  it("expira entradas após o TTL", () => {
    jest.useFakeTimers();
    try {
      const cache = createMsgRetryCounterCache(1_000, 10);
      cache.set("a", 1);

      expect(cache.get("a")).toBe(1);
      jest.advanceTimersByTime(1_001);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.size).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("re-set da mesma chave não evicta e renova o TTL", () => {
    const cache = createMsgRetryCounterCache(60_000, 2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 9); // re-set: nenhuma evicção

    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBe(9);
    expect(cache.get("b")).toBe(2);
  });

  it("uma instância nova (geração substituída) começa vazia", () => {
    const first = createMsgRetryCounterCache();
    first.set("a", 1);

    const next = createMsgRetryCounterCache();
    expect(next.get("a")).toBeUndefined();
    expect(next.size).toBe(0);
  });

  it("del e flushAll removem entradas", () => {
    const cache = createMsgRetryCounterCache();
    cache.set("a", 1);
    cache.set("b", 2);
    cache.del("a");
    expect(cache.get("a")).toBeUndefined();
    cache.flushAll();
    expect(cache.size).toBe(0);
  });
});
