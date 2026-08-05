import {
  WhatsAppSessionManager,
  ManagedSocket,
  StartSessionInput
} from "../WhatsAppSessionManager";
import {
  acquireSessionLease,
  renewSessionLease,
  releaseSessionLease
} from "../../../messaging/public/sessionLeases";

jest.mock("../../../messaging/public/sessionLeases", () => ({
  acquireSessionLease: jest.fn(),
  renewSessionLease: jest.fn(),
  releaseSessionLease: jest.fn()
}));

const acquireMock = acquireSessionLease as jest.Mock;
const renewMock = renewSessionLease as jest.Mock;
const releaseMock = releaseSessionLease as jest.Mock;

const makeFakeSocket = (): ManagedSocket & {
  ev: { removeAllListeners: jest.Mock };
  ws: { close: jest.Mock };
  logout: jest.Mock;
} => ({
  user: undefined,
  ev: { removeAllListeners: jest.fn() },
  ws: { close: jest.fn() },
  logout: jest.fn()
});

const LEASE = { whatsappId: 1, ownerId: "owner-a", fencingToken: "1" };

const makeManager = (
  factory: jest.Mock,
  overrides: Record<string, unknown> = {}
) =>
  new WhatsAppSessionManager({
    ownerId: "owner-a",
    socketFactory: factory,
    heartbeatIntervalMs: 60000,
    leaseTtlMs: 30000,
    ...overrides
  });

const input = (onCreated?: (s: unknown) => void): StartSessionInput => ({
  whatsapp: { id: 1, companyId: 10 },
  onCreated: onCreated as StartSessionInput["onCreated"]
});

beforeEach(() => {
  acquireMock.mockReset().mockResolvedValue({ ...LEASE });
  renewMock.mockReset().mockResolvedValue(true);
  releaseMock.mockReset().mockResolvedValue(true);
});

describe("single-flight local", () => {
  it("duas chamadas start simultaneas executam a factory uma vez e recebem a mesma sessao", async () => {
    const socket = makeFakeSocket();
    const factory = jest.fn().mockResolvedValue(socket);
    const manager = makeManager(factory);

    const [a, b] = await Promise.all([
      manager.start(input()),
      manager.start(input())
    ]);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(manager.diagnostics(1).activeSocketCount).toBe(1);
  });

  it("dez cliques concorrentes em conectar deixam activeSocketCount=1", async () => {
    const socket = makeFakeSocket();
    const factory = jest.fn().mockResolvedValue(socket);
    const manager = makeManager(factory);

    const sessions = await Promise.all(
      Array.from({ length: 10 }, () => manager.start(input()))
    );

    expect(factory).toHaveBeenCalledTimes(1);
    expect(new Set(sessions).size).toBe(1);
    expect(manager.diagnostics(1).activeSocketCount).toBe(1);
  });

  it("start apos o primeiro retorna a sessao ativa sem nova factory", async () => {
    const socket = makeFakeSocket();
    const factory = jest.fn().mockResolvedValue(socket);
    const manager = makeManager(factory);

    const first = await manager.start(input());
    const second = await manager.start(input());

    expect(factory).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("onCreated dispara uma unica vez, somente para a sessao nova", async () => {
    const factory = jest.fn().mockResolvedValue(makeFakeSocket());
    const manager = makeManager(factory);
    const onCreated = jest.fn();

    await Promise.all([
      manager.start(input(onCreated)),
      manager.start(input(onCreated))
    ]);
    await manager.start(input(onCreated));

    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("falha da factory libera a lease e a proxima start tenta de novo", async () => {
    const factory = jest
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(makeFakeSocket());
    const manager = makeManager(factory);

    await expect(manager.start(input())).rejects.toThrow("boom");
    expect(releaseMock).toHaveBeenCalledWith({
      whatsappId: 1,
      ownerId: "owner-a",
      fencingToken: "1"
    });
    expect(manager.diagnostics(1).inFlight).toBe(false);

    await expect(manager.start(input())).resolves.toBeDefined();
    expect(factory).toHaveBeenCalledTimes(2);
  });
});

describe("lease e fencing", () => {
  it("lease negada (outro owner vigente) falha fechado: nenhum socket abre", async () => {
    acquireMock.mockResolvedValue(null);
    const factory = jest.fn();
    const manager = makeManager(factory);

    await expect(manager.start(input())).rejects.toMatchObject({
      message: "ERR_WAPP_SESSION_LEASE_UNAVAILABLE"
    });
    expect(factory).not.toHaveBeenCalled();
    expect(manager.diagnostics(1).activeSocketCount).toBe(0);
  });

  it("erro na aquisicao da lease falha fechado sem chamar a factory", async () => {
    acquireMock.mockRejectedValue(new Error("postgres down"));
    const factory = jest.fn();
    const manager = makeManager(factory);

    await expect(manager.start(input())).rejects.toThrow("postgres down");
    expect(factory).not.toHaveBeenCalled();
  });

  it("replace fecha e remove listeners da sessao anterior antes de publicar a nova", async () => {
    const first = makeFakeSocket();
    const second = makeFakeSocket();
    const events: string[] = [];
    const factory = jest
      .fn()
      .mockImplementationOnce(async () => {
        events.push("factory-1");
        return first;
      })
      .mockImplementationOnce(async () => {
        events.push("factory-2");
        return second;
      });
    acquireMock.mockResolvedValueOnce({ ...LEASE }).mockResolvedValueOnce({
      ...LEASE,
      fencingToken: "2"
    });
    const manager = makeManager(factory);

    const firstSession = await manager.start(input());
    first.ev.removeAllListeners.mockImplementation(() =>
      events.push("remove-listeners")
    );
    first.ws.close.mockImplementation(() => events.push("close-socket"));

    const secondSession = await manager.replace(input(), "manual");

    expect(factory).toHaveBeenCalledTimes(2);
    expect(secondSession).not.toBe(firstSession);
    expect(secondSession.generation).toBe("2");
    expect(events).toEqual([
      "factory-1",
      "remove-listeners",
      "close-socket",
      "factory-2"
    ]);
    expect(manager.diagnostics(1).activeSocketCount).toBe(1);
  });

  it("callback de geracao antiga nao executa efeito apos o replace", async () => {
    const factory = jest
      .fn()
      .mockResolvedValueOnce(makeFakeSocket())
      .mockResolvedValueOnce(makeFakeSocket());
    acquireMock
      .mockResolvedValueOnce({ ...LEASE })
      .mockResolvedValueOnce({ ...LEASE, fencingToken: "2" });
    const manager = makeManager(factory);

    const oldSession = await manager.start(input());
    const newSession = await manager.replace(input(), "manual");

    expect(manager.isCurrent(1, oldSession.generation)).toBe(false);
    expect(manager.isCurrent(1, newSession.generation)).toBe(true);

    const staleEffect = jest.fn();
    const freshEffect = jest.fn().mockReturnValue("ok");
    await manager.runFenced(1, oldSession.generation, staleEffect);
    await expect(
      manager.runFenced(1, newSession.generation, freshEffect)
    ).resolves.toBe("ok");

    expect(staleEffect).not.toHaveBeenCalled();
    expect(freshEffect).toHaveBeenCalledTimes(1);
  });

  it("perda da lease (renew=false) fecha o socket imediatamente e nunca rearma", async () => {
    const socket = makeFakeSocket();
    const onSessionEnded = jest.fn();
    const manager = makeManager(jest.fn().mockResolvedValue(socket), {
      onSessionEnded
    });
    await manager.start(input());

    renewMock.mockResolvedValue(false);
    await (manager as any).heartbeatTick(manager.getActive(1));

    expect(socket.ev.removeAllListeners).toHaveBeenCalled();
    expect(socket.ws.close).toHaveBeenCalled();
    expect(manager.diagnostics(1).activeSocketCount).toBe(0);
    // Takeover definitivo: reconectar viraria loop de takeover.
    expect(manager.diagnostics(1).reconnectScheduled).toBe(false);
    expect(onSessionEnded).not.toHaveBeenCalled();
  });

  it("perda por falhas transitorias consecutivas rearma o canal pelo caminho gerenciado", async () => {
    jest.useFakeTimers();
    try {
      const socket = makeFakeSocket();
      const onSessionEnded = jest.fn();
      const manager = makeManager(jest.fn().mockResolvedValue(socket), {
        onSessionEnded
      });
      await manager.start(input());

      renewMock.mockRejectedValue(new Error("timeout"));
      await (manager as any).heartbeatTick(manager.getActive(1));
      await (manager as any).heartbeatTick(
        manager.getActiveIfPresent(1) ?? { whatsappId: 1 }
      );

      expect(socket.ws.close).toHaveBeenCalled();
      expect(manager.diagnostics(1).activeSocketCount).toBe(0);
      expect(manager.diagnostics(1).reconnectScheduled).toBe(true);

      jest.advanceTimersByTime(5100);
      expect(onSessionEnded).toHaveBeenCalledWith(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("tolerancia controlada: uma falha transitoria mantem, duas fecham", async () => {
    const socket = makeFakeSocket();
    const manager = makeManager(jest.fn().mockResolvedValue(socket));
    await manager.start(input());

    renewMock.mockRejectedValue(new Error("timeout"));
    await (manager as any).heartbeatTick(manager.getActive(1));
    expect(manager.diagnostics(1).activeSocketCount).toBe(1);
    expect(manager.diagnostics(1).renewalFailures).toBe(1);

    await (manager as any).heartbeatTick(
      manager.getActiveIfPresent(1) ?? {
        whatsappId: 1
      }
    );
    expect(socket.ws.close).toHaveBeenCalled();
    expect(manager.diagnostics(1).activeSocketCount).toBe(0);
  });

  it("falha transitoria isolada zera o contador na renovacao seguinte", async () => {
    const manager = makeManager(jest.fn().mockResolvedValue(makeFakeSocket()));
    await manager.start(input());

    renewMock.mockRejectedValueOnce(new Error("timeout"));
    await (manager as any).heartbeatTick(manager.getActive(1));
    expect(manager.diagnostics(1).renewalFailures).toBe(1);

    await (manager as any).heartbeatTick(manager.getActive(1));
    expect(manager.diagnostics(1).renewalFailures).toBe(0);
    expect(manager.diagnostics(1).activeSocketCount).toBe(1);
  });

  it("heartbeat nao sobrepoe ticks enquanto uma renovacao esta pendente", async () => {
    let resolveRenew: (v: boolean) => void = () => undefined;
    renewMock.mockImplementation(
      () =>
        new Promise<boolean>(resolve => {
          resolveRenew = resolve;
        })
    );
    const manager = makeManager(jest.fn().mockResolvedValue(makeFakeSocket()));
    await manager.start(input());
    const session = manager.getActive(1);

    const tick1 = (manager as any).heartbeatTick(session);
    const tick2 = (manager as any).heartbeatTick(session);
    resolveRenew(true);
    await Promise.all([tick1, tick2]);

    expect(renewMock).toHaveBeenCalledTimes(1);
  });
});

describe("stop", () => {
  it("stop close nao faz logout e libera a lease com o token vigente", async () => {
    const socket = makeFakeSocket();
    const manager = makeManager(jest.fn().mockResolvedValue(socket));
    await manager.start(input());

    await manager.stop(1, "close");

    expect(socket.logout).not.toHaveBeenCalled();
    expect(socket.ws.close).toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalledWith({
      whatsappId: 1,
      ownerId: "owner-a",
      fencingToken: "1"
    });
    expect(manager.diagnostics(1).activeSocketCount).toBe(0);
  });

  it("stop logout chama logout do provedor e encerra a sessao", async () => {
    const socket = makeFakeSocket();
    const manager = makeManager(jest.fn().mockResolvedValue(socket));
    await manager.start(input());

    await manager.stop(1, "logout");

    expect(socket.logout).toHaveBeenCalled();
    expect(socket.ws.close).toHaveBeenCalled();
    expect(manager.diagnostics(1).activeSocketCount).toBe(0);
  });

  it("stop sem sessao ativa e no-op seguro", async () => {
    const manager = makeManager(jest.fn());
    await expect(manager.stop(999, "close")).resolves.toBeUndefined();
    expect(releaseMock).not.toHaveBeenCalled();
  });
});

describe("getReady e getActive", () => {
  it("getReady resolve quando o socket esta autenticado", async () => {
    const socket = makeFakeSocket();
    const manager = makeManager(jest.fn().mockResolvedValue(socket));
    await manager.start(input());
    socket.user = { id: "me" };

    await expect(manager.getReady(1, 50)).resolves.toMatchObject({
      whatsappId: 1
    });
  });

  it("getReady expira com 503 quando a sessao nao autentica a tempo", async () => {
    const manager = makeManager(jest.fn().mockResolvedValue(makeFakeSocket()));
    await manager.start(input());

    await expect(manager.getReady(1, 30)).rejects.toMatchObject({
      message: "ERR_WAPP_NOT_AVAILABLE",
      statusCode: 503
    });
  });

  it("getActive devolve sessao em QR/opening e falha quando ausente", async () => {
    const manager = makeManager(jest.fn().mockResolvedValue(makeFakeSocket()));
    await manager.start(input());

    expect(manager.getActive(1)).toMatchObject({ whatsappId: 1 });
    expect(() => manager.getActive(999)).toThrow("ERR_WAPP_NOT_INITIALIZED");
  });
});

describe("corridas de lifecycle serializadas por canal", () => {
  it("stop durante start revoga a tentativa: sessao nao publica nem abre socket", async () => {
    const factory = jest.fn(
      () =>
        new Promise<ManagedSocket>(resolve =>
          setTimeout(() => resolve(makeFakeSocket()), 10)
        )
    );
    const manager = makeManager(factory);

    const startPromise = manager.start(input());
    const stopPromise = manager.stop(1, "close");

    await expect(startPromise).rejects.toMatchObject({
      message: "ERR_WAPP_SESSION_SUPERSEDED"
    });
    await stopPromise;

    // Revogada antes do lease: a factory nem roda e a lease e liberada.
    expect(factory).not.toHaveBeenCalled();
    expect(manager.diagnostics(1).activeSocketCount).toBe(0);
    expect(releaseMock).toHaveBeenCalledWith({
      whatsappId: 1,
      ownerId: "owner-a",
      fencingToken: "1"
    });
  });

  it("replace durante start revoga a tentativa antiga e publica a geracao nova", async () => {
    const second = makeFakeSocket();
    const factory = jest.fn().mockResolvedValue(second);
    acquireMock
      .mockResolvedValueOnce({ ...LEASE })
      .mockResolvedValueOnce({ ...LEASE, fencingToken: "2" });
    const manager = makeManager(factory);

    const startPromise = manager.start(input());
    const replacePromise = manager.replace(input(), "manual");

    await expect(startPromise).rejects.toMatchObject({
      message: "ERR_WAPP_SESSION_SUPERSEDED"
    });
    const secondSession = await replacePromise;

    // A tentativa antiga morre antes da factory; so a substituta abre socket.
    expect(factory).toHaveBeenCalledTimes(1);
    expect(secondSession.generation).toBe("2");
    expect(manager.diagnostics(1).activeSocketCount).toBe(1);
    expect(manager.isCurrent(1, "1")).toBe(false);
    expect(manager.isCurrent(1, "2")).toBe(true);
  });

  it("start durante stop aguarda a fila e publica sessao nova (sem zumbi)", async () => {
    const first = makeFakeSocket();
    const second = makeFakeSocket();
    const factory = jest
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const manager = makeManager(factory);

    await manager.start(input());
    const stopPromise = manager.stop(1, "close");
    const startPromise = manager.start(input());
    const [, session] = await Promise.all([stopPromise, startPromise]);

    expect(factory).toHaveBeenCalledTimes(2);
    expect(session.socket).toBe(second);
    expect(manager.diagnostics(1).activeSocketCount).toBe(1);
  });
});

describe("monotonicidade de geracao e teto de reconexao", () => {
  it("token nunca e reciclado: stop -> start gera geracao nova e callback antigo fica inerte", async () => {
    const factory = jest.fn().mockResolvedValue(makeFakeSocket());
    acquireMock
      .mockResolvedValueOnce({ ...LEASE })
      .mockResolvedValueOnce({ ...LEASE, fencingToken: "2" });
    const manager = makeManager(factory);

    const first = await manager.start(input());
    await manager.stop(1, "close");
    const second = await manager.start(input());

    expect(first.generation).toBe("1");
    expect(second.generation).toBe("2");

    const stale = jest.fn();
    await manager.runFenced(1, first.generation, stale);
    expect(stale).not.toHaveBeenCalled();
    expect(manager.isCurrent(1, "2")).toBe(true);
  });

  it("stopIfCurrent de geracao antiga nao derruba nem reagenda a sessao nova", async () => {
    const first = makeFakeSocket();
    const second = makeFakeSocket();
    const factory = jest
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    acquireMock
      .mockResolvedValueOnce({ ...LEASE })
      .mockResolvedValueOnce({ ...LEASE, fencingToken: "2" });
    const manager = makeManager(factory);

    await manager.start(input());
    await manager.replace(input(), "manual");

    // Callback close da geracao antiga chegando depois do replace.
    const stopped = await manager.stopIfCurrent(1, "1", "close");
    expect(stopped).toBe(false);
    expect(second.ws.close).not.toHaveBeenCalled();
    expect(manager.diagnostics(1).activeSocketCount).toBe(1);
    expect(manager.diagnostics(1).reconnectScheduled).toBe(false);

    // A geracao vigente ainda pode ser encerrada normalmente.
    const stoppedCurrent = await manager.stopIfCurrent(1, "2", "close");
    expect(stoppedCurrent).toBe(true);
    expect(second.ws.close).toHaveBeenCalled();
    expect(manager.diagnostics(1).activeSocketCount).toBe(0);
  });

  it("tryScheduleReconnect aplica o teto da policy e zera no open", async () => {
    jest.useFakeTimers();
    try {
      const manager = makeManager(jest.fn());
      const fn = jest.fn();

      // Desconexao desconhecida: uma unica tentativa controlada.
      expect(manager.tryScheduleReconnect(1, 1000, 1, fn)).toBe(true);
      expect(manager.tryScheduleReconnect(1, 1000, 1, fn)).toBe(false);
      jest.advanceTimersByTime(1100);
      expect(fn).toHaveBeenCalledTimes(1);

      // Open da sessao zera o contador: nova tentativa permitida.
      manager.resetReconnectAttempts(1);
      expect(manager.tryScheduleReconnect(1, 1000, 1, fn)).toBe(true);
      expect(manager.diagnostics(1).reconnectAttempts).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("stop manual zera o contador de tentativas de reconexao", async () => {
    const manager = makeManager(jest.fn().mockResolvedValue(makeFakeSocket()));
    await manager.start(input());
    manager.tryScheduleReconnect(1, 60000, 5, jest.fn());
    expect(manager.diagnostics(1).reconnectAttempts).toBe(1);

    await manager.stop(1, "close");
    expect(manager.diagnostics(1).reconnectAttempts).toBe(0);
  });
});

describe("contadores de QR e reconexao", () => {
  it("incrementa, consulta e zera o contador de QR por canal", async () => {
    const manager = makeManager(jest.fn());

    expect(manager.incrementQrRetries(1)).toBe(1);
    expect(manager.incrementQrRetries(1)).toBe(2);
    expect(manager.getQrRetries(1)).toBe(2);
    manager.resetQrRetries(1);
    expect(manager.getQrRetries(1)).toBe(0);
  });

  it("stop limpa o contador de QR do canal", async () => {
    const manager = makeManager(jest.fn().mockResolvedValue(makeFakeSocket()));
    await manager.start(input());
    manager.incrementQrRetries(1);

    await manager.stop(1, "close");

    expect(manager.getQrRetries(1)).toBe(0);
  });

  it("scheduleReconnect mantem um unico timer por canal", async () => {
    jest.useFakeTimers();
    try {
      const manager = makeManager(jest.fn());
      const first = jest.fn();
      const second = jest.fn();

      manager.scheduleReconnect(1, 1000, first);
      manager.scheduleReconnect(1, 1000, second);
      expect(manager.diagnostics(1).reconnectScheduled).toBe(true);

      jest.advanceTimersByTime(1100);
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);

      manager.scheduleReconnect(1, 1000, first);
      manager.cancelReconnect(1);
      jest.advanceTimersByTime(1100);
      expect(first).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("replace durante start em voo: geracao pendente nao publica nem notifica onCreated", async () => {
    acquireMock
      .mockReset()
      .mockResolvedValueOnce({ ...LEASE, fencingToken: "1" })
      .mockResolvedValue({ ...LEASE, fencingToken: "2" });
    let resolveFactory!: (socket: unknown) => void;
    const firstSocket = makeFakeSocket();
    const factory = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveFactory = resolve;
          })
      )
      .mockImplementation(() => Promise.resolve(makeFakeSocket()));
    const manager = makeManager(factory);
    const onCreatedFirst = jest.fn();

    const startPromise = manager.start(
      input(onCreatedFirst as StartSessionInput["onCreated"])
    );
    // lease da primeira tentativa resolve; factory fica em voo
    await new Promise(resolve => setTimeout(resolve, 0));

    const replacement = manager.replace({ whatsapp: { id: 1, companyId: 10 } });
    resolveFactory(firstSocket);

    await expect(startPromise).rejects.toMatchObject({
      message: "ERR_WAPP_SESSION_SUPERSEDED"
    });
    const session = await replacement;

    expect(onCreatedFirst).not.toHaveBeenCalled();
    expect(firstSocket.ev.removeAllListeners).toHaveBeenCalled();
    expect(firstSocket.ws.close).toHaveBeenCalled();
    expect(manager.isCurrent(1, "1")).toBe(false);
    expect(session.generation).toBe("2");
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("stop durante start em voo revoga a geracao pendente (isCurrent nega na hora)", async () => {
    let resolveFactory!: (socket: unknown) => void;
    const factory = jest.fn().mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveFactory = resolve;
        })
    );
    const manager = makeManager(factory);

    const startPromise = manager.start(input());
    await new Promise(resolve => setTimeout(resolve, 0));

    // fencingToken do LEASE ("1") e a geracao pendente: vigente em voo
    expect(manager.isCurrent(1, "1")).toBe(true);

    const stopPromise = manager.stop(1, "close");
    expect(manager.isCurrent(1, "1")).toBe(false);

    resolveFactory(makeFakeSocket());
    await expect(startPromise).rejects.toMatchObject({
      message: "ERR_WAPP_SESSION_SUPERSEDED"
    });
    await stopPromise;
    expect(manager.getActiveIfPresent(1)).toBeUndefined();
  });

  it("runLifecycleEffect nao executa quando a geracao nao e vigente", async () => {
    const manager = makeManager(jest.fn());
    const effect = jest.fn(async () => undefined);

    const ran = await manager.runLifecycleEffect(1, "9", effect);

    expect(ran).toBe(false);
    expect(effect).not.toHaveBeenCalled();
  });

  it("runLifecycleEffect serializa com replace: efeito em voo termina antes", async () => {
    const factory = jest
      .fn()
      .mockImplementation(() => Promise.resolve(makeFakeSocket()));
    const manager = makeManager(factory);
    await manager.start(input());
    const order: string[] = [];
    let releaseEffect!: () => void;

    const effectPromise = manager.runLifecycleEffect(1, "1", async () => {
      order.push("effect:start");
      await new Promise<void>(resolve => {
        releaseEffect = resolve;
      });
      order.push("effect:end");
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    const replacePromise = manager.replace(input(), "manual").then(session => {
      order.push("replace:done");
      return session;
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    // O replace aguarda na fila do canal enquanto o efeito esta em voo.
    expect(order).toEqual(["effect:start"]);

    releaseEffect();
    await effectPromise;
    await replacePromise;
    expect(order).toEqual(["effect:start", "effect:end", "replace:done"]);
  });

  it("listActiveSessionIds reflete os canais publicados e remove no stop", async () => {
    const factory = jest
      .fn()
      .mockImplementation(() => Promise.resolve(makeFakeSocket()));
    const manager = makeManager(factory);

    await manager.start({ whatsapp: { id: 7, companyId: 10 } });
    await manager.start({ whatsapp: { id: 8, companyId: 10 } });
    expect(manager.listActiveSessionIds().sort()).toEqual([7, 8]);

    await manager.stop(7, "close");
    expect(manager.listActiveSessionIds()).toEqual([8]);
  });
});
