import { handleAuthWritePersistentFailure } from "../authWriteFailurePolicy";
import { getSessionManager } from "../WhatsAppSessionManager";
import { logger } from "../../../utils/logger";

jest.mock("../WhatsAppSessionManager", () => ({
  getSessionManager: jest.fn()
}));

jest.mock("../../../utils/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

type Effect = () => Promise<void>;

const makeManager = (currentFn: () => boolean) => ({
  isCurrent: jest.fn(currentFn),
  stopIfCurrent: jest.fn(async () => currentFn()),
  runLifecycleEffect: jest.fn(
    async (_id: number, _generation: string, effect: Effect) => {
      if (!currentFn()) return false;
      await effect();
      return true;
    }
  )
});

const makeWhatsapp = () =>
  ({
    id: 26,
    companyId: 1,
    update: jest.fn().mockResolvedValue([1])
  } as any);

beforeEach(() => {
  jest.clearAllMocks();
});

describe("handleAuthWritePersistentFailure", () => {
  it("geracao vigente: sinaliza DISCONNECTED, emite e encerra a sessao", async () => {
    const manager = makeManager(() => true);
    (getSessionManager as jest.Mock).mockReturnValue(manager);
    const whatsapp = makeWhatsapp();
    const emit = jest.fn();

    await handleAuthWritePersistentFailure({
      whatsapp,
      generation: "4",
      emit
    });

    expect(manager.runLifecycleEffect).toHaveBeenCalledWith(
      26,
      "4",
      expect.any(Function)
    );
    expect(whatsapp.update).toHaveBeenCalledWith({ status: "DISCONNECTED" });
    expect(emit).toHaveBeenCalledWith(
      "company-1-mainchannel",
      "company-1-whatsappSession",
      { action: "update", session: whatsapp }
    );
    expect(manager.stopIfCurrent).toHaveBeenCalledWith(26, "4", "close");
  });

  it("geracao substituida: nao sinaliza, nao emite e nao encerra a sessao nova", async () => {
    const manager = makeManager(() => false);
    (getSessionManager as jest.Mock).mockReturnValue(manager);
    const whatsapp = makeWhatsapp();
    const emit = jest.fn();

    await handleAuthWritePersistentFailure({
      whatsapp,
      generation: "3",
      emit
    });

    expect(whatsapp.update).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(manager.stopIfCurrent).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalled();
  });

  it("falha ao sinalizar nao impede o encerramento da sessao", async () => {
    const manager = makeManager(() => true);
    (getSessionManager as jest.Mock).mockReturnValue(manager);
    const whatsapp = makeWhatsapp();
    whatsapp.update.mockRejectedValue(new Error("db down"));
    const emit = jest.fn();

    await handleAuthWritePersistentFailure({
      whatsapp,
      generation: "4",
      emit
    });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ whatsappId: 26 }),
      expect.stringContaining("sinalizar")
    );
    expect(manager.stopIfCurrent).toHaveBeenCalledWith(26, "4", "close");
  });

  it("replace durante o update de status: emit da geracao vencida e suprimido", async () => {
    let current = true;
    const manager = makeManager(() => current);
    (getSessionManager as jest.Mock).mockReturnValue(manager);
    const whatsapp = makeWhatsapp();
    let releaseUpdate!: () => void;
    whatsapp.update.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          releaseUpdate = () => resolve([1]);
        })
    );
    const emit = jest.fn();

    const policy = handleAuthWritePersistentFailure({
      whatsapp,
      generation: "4",
      emit
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    // O replace acontece com a escrita de status em voo.
    current = false;
    releaseUpdate();
    await policy;

    // A escrita iniciou vigente (janela minima ate o banco), mas o emit da
    // geracao vencida nao sai; o stop condicional e chamado e recusa.
    expect(emit).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      { whatsappId: 26 },
      expect.stringContaining("suprimido")
    );
    expect(manager.stopIfCurrent).toHaveBeenCalledWith(26, "4", "close");
  });
});
