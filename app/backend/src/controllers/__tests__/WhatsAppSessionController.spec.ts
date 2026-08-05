import controller from "../WhatsAppSessionController";
import ShowWhatsAppService from "../../services/WhatsappService/ShowWhatsAppService";
import UpdateWhatsAppService from "../../services/WhatsappService/UpdateWhatsAppService";
import { StartWhatsAppSession } from "../../services/WbotServices/StartWhatsAppSession";
import { getSessionManager } from "../../services/WbotServices/WhatsAppSessionManager";

jest.mock("../../services/WhatsappService/ShowWhatsAppService", () => ({
  __esModule: true,
  default: jest.fn()
}));
jest.mock("../../services/WhatsappService/UpdateWhatsAppService", () => ({
  __esModule: true,
  default: jest.fn()
}));
jest.mock("../../services/WbotServices/StartWhatsAppSession", () => ({
  StartWhatsAppSession: jest.fn()
}));
jest.mock("../../services/WbotServices/WhatsAppSessionManager", () => ({
  getSessionManager: jest.fn()
}));
jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

const showMock = ShowWhatsAppService as jest.Mock;
const updateSvcMock = UpdateWhatsAppService as jest.Mock;
const startMock = StartWhatsAppSession as jest.Mock;
const getManagerMock = getSessionManager as jest.Mock;

const makeRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const makeReq = (whatsappId = "7", companyId = 1): any => ({
  params: { whatsappId },
  user: { companyId }
});

describe("WhatsAppSessionController", () => {
  beforeEach(() => jest.clearAllMocks());

  it("store conecta via manager.start (sem replace)", async () => {
    const whatsapp = { id: 7, companyId: 1 };
    showMock.mockResolvedValue(whatsapp);
    const res = makeRes();

    await controller.store(makeReq(), res);

    expect(startMock).toHaveBeenCalledWith(whatsapp, 1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("update re-pareia via manager.replace", async () => {
    const whatsapp = { id: 7, companyId: 1 };
    updateSvcMock.mockResolvedValue({ whatsapp });
    const res = makeRes();

    await controller.update(makeReq(), res);

    expect(updateSvcMock).toHaveBeenCalledWith({
      whatsappId: "7",
      companyId: 1,
      whatsappData: { session: "" }
    });
    expect(startMock).toHaveBeenCalledWith(whatsapp, 1, { replace: true });
  });

  it("remove desconecta via manager.stop('logout') e limpa a credencial", async () => {
    const stop = jest.fn().mockResolvedValue(undefined);
    getManagerMock.mockReturnValue({ stop });
    const whatsapp = {
      id: 7,
      companyId: 1,
      session: "credencial",
      update: jest.fn().mockResolvedValue(undefined)
    };
    showMock.mockResolvedValue(whatsapp);
    const res = makeRes();

    await controller.remove(makeReq(), res);

    expect(stop).toHaveBeenCalledWith(7, "logout");
    expect(whatsapp.update).toHaveBeenCalledWith({
      status: "DISCONNECTED",
      session: ""
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("remove sem credencial nao chama stop nem limpa status", async () => {
    const stop = jest.fn();
    getManagerMock.mockReturnValue({ stop });
    const whatsapp = { id: 7, companyId: 1, session: "", update: jest.fn() };
    showMock.mockResolvedValue(whatsapp);
    const res = makeRes();

    await controller.remove(makeReq(), res);

    expect(stop).not.toHaveBeenCalled();
    expect(whatsapp.update).not.toHaveBeenCalled();
  });

  it("remove tolera falha do stop e ainda limpa a credencial", async () => {
    const stop = jest.fn().mockRejectedValue(new Error("ws fechado"));
    getManagerMock.mockReturnValue({ stop });
    const whatsapp = {
      id: 7,
      session: "x",
      update: jest.fn().mockResolvedValue(undefined)
    };
    showMock.mockResolvedValue(whatsapp);
    const res = makeRes();

    await controller.remove(makeReq(), res);

    expect(whatsapp.update).toHaveBeenCalledWith({
      status: "DISCONNECTED",
      session: ""
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
