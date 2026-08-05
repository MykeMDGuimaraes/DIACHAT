import { StartAllWhatsAppsSessions } from "../StartAllWhatsAppsSessions";
import ListWhatsAppsService from "../../WhatsappService/ListWhatsAppsService";
import { StartWhatsAppSession } from "../StartWhatsAppSession";

jest.mock("../../WhatsappService/ListWhatsAppsService", () => ({
  __esModule: true,
  default: jest.fn()
}));
jest.mock("../StartWhatsAppSession", () => ({
  StartWhatsAppSession: jest.fn()
}));
jest.mock("@sentry/node", () => ({ captureException: jest.fn() }));
jest.mock("../../../utils/logger", () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() }
}));

const mockedList = ListWhatsAppsService as jest.Mock;
const mockedStart = StartWhatsAppSession as jest.Mock;

const pairedSession = JSON.stringify({
  creds: { me: { id: "553198232461:25@s.whatsapp.net" }, noiseKey: {} },
  keys: {}
});

describe("StartAllWhatsAppsSessions", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("starts only sessions with paired credentials (creds.me)", async () => {
    const paired = { id: 26, name: "real", session: pairedSession };
    const empty = { id: 3, name: "novo canal", session: "" };
    const nullSession = { id: 4, name: "sem session", session: null };
    const noMe = {
      id: 5,
      name: "nunca pareado",
      session: JSON.stringify({ creds: { noiseKey: {} }, keys: {} })
    };
    const brokenJson = { id: 6, name: "json truncado", session: '{"creds":' };
    mockedList.mockResolvedValue([paired, empty, nullSession, noMe, brokenJson]);

    await StartAllWhatsAppsSessions(1);

    expect(mockedStart).toHaveBeenCalledTimes(1);
    expect(mockedStart).toHaveBeenCalledWith(paired, 1);
  });

  it("starts nothing when no session has credentials", async () => {
    mockedList.mockResolvedValue([
      { id: 3, name: "novo canal", session: "" },
      { id: 4, name: "outro", session: null }
    ]);

    await StartAllWhatsAppsSessions(1);

    expect(mockedStart).not.toHaveBeenCalled();
  });

  it("aguarda a conclusao das inicializacoes (sem descartar Promises)", async () => {
    let finished = false;
    mockedStart.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
      finished = true;
    });
    mockedList.mockResolvedValue([{ id: 26, session: pairedSession }]);

    await StartAllWhatsAppsSessions(1);

    expect(finished).toBe(true);
  });
});
