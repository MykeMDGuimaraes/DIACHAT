import { fenceSessionListener } from "../sessionListenerGuard";
import { getSessionManager } from "../WhatsAppSessionManager";

jest.mock("../WhatsAppSessionManager", () => ({
  getSessionManager: jest.fn()
}));

const mockGetSessionManager = getSessionManager as jest.Mock;

describe("sessionListenerGuard", () => {
  beforeEach(() => jest.clearAllMocks());

  it("geracao vigente: handler executa com os argumentos originais", async () => {
    const handler = jest.fn().mockResolvedValue("ok");
    const runFenced = jest.fn((_id: number, _gen: string, fn: () => unknown) => fn());
    mockGetSessionManager.mockReturnValue({ runFenced });

    const fenced = fenceSessionListener(5, "gen-1", handler);
    await fenced("evento", 42);

    expect(runFenced).toHaveBeenCalledWith(5, "gen-1", expect.any(Function));
    expect(handler).toHaveBeenCalledWith("evento", 42);
  });

  it("geracao vencida: handler fica inerte (runFenced suprime)", async () => {
    const handler = jest.fn();
    const runFenced = jest.fn().mockResolvedValue(undefined); // geracao vencida
    mockGetSessionManager.mockReturnValue({ runFenced });

    const fenced = fenceSessionListener(5, "gen-antiga", handler);
    const result = await fenced("evento");

    expect(handler).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("sem geracao (legado): handler executa direto, sem consultar o manager", async () => {
    const handler = jest.fn().mockReturnValue("direto");

    const fenced = fenceSessionListener(undefined, undefined, handler);
    const result = await fenced(1);

    expect(handler).toHaveBeenCalledWith(1);
    expect(result).toBe("direto");
    expect(mockGetSessionManager).not.toHaveBeenCalled();
  });
});
