jest.mock("jsonwebtoken", () => ({ verify: jest.fn() }));
jest.mock("../../libs/auditLog", () => ({
  audit: jest.fn(),
  requestIp: jest.fn(() => "127.0.0.1")
}));
jest.mock("../../middleware/isServiceAuth", () => ({
  verifyServiceToken: jest.fn().mockResolvedValue(null)
}));
jest.mock("../../models/QuickMessage", () => ({
  __esModule: true,
  default: { findOne: jest.fn() }
}));
jest.mock("../../models/Announcement", () => ({
  __esModule: true,
  default: { findOne: jest.fn() }
}));
jest.mock("../../models/Campaign", () => ({
  __esModule: true,
  default: { findOne: jest.fn() }
}));
jest.mock("../../models/Schedule", () => ({
  __esModule: true,
  default: { findOne: jest.fn() }
}));
jest.mock("../../models/FlowAudio", () => ({
  FlowAudioModel: { findOne: jest.fn() }
}));
jest.mock("../../models/FlowImg", () => ({
  FlowImgModel: { findOne: jest.fn() }
}));
jest.mock("../../models/FilesOptions", () => ({
  __esModule: true,
  default: { findOne: jest.fn() }
}));
jest.mock("../../models/Files", () => ({ __esModule: true, default: {} }));

/* eslint-disable import/first */
import { verify } from "jsonwebtoken";
import Message from "../../models/Message";
import mediaAuth from "../../middleware/mediaAuth";
/* eslint-enable import/first */

const OLD_BACKEND_URL = process.env.BACKEND_URL;

const makeReq = (path: string): any => ({
  path,
  headers: { authorization: "Bearer jwt-de-usuario" },
  query: {}
});

const makeRes = (): any => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("Contrato de URL de midia do outbox (Task 4)", () => {
  beforeAll(() => {
    process.env.BACKEND_URL = "https://backend.test";
  });
  afterAll(() => {
    process.env.BACKEND_URL = OLD_BACKEND_URL;
  });

  describe("getter Message.mediaUrl", () => {
    // O modelo nao pode ser instanciado fora de uma instancia Sequelize;
    // chama-se o getter do prototipo com um contexto minimo equivalente.
    const mediaUrlOf = (stored: string | null): string | null => {
      const descriptor = Object.getOwnPropertyDescriptor(
        Message.prototype,
        "mediaUrl"
      );
      const getter = descriptor?.get as () => string | null;
      return getter.call({ getDataValue: () => stored });
    };

    it("midia staged (messaging/...) aponta para o mount autenticado /media", () => {
      expect(mediaUrlOf("messaging/uuid-foto.jpg")).toBe(
        "https://backend.test/media/messaging/uuid-foto.jpg"
      );
    });

    it("midia legada (arquivo solto em public/) mantem o prefixo /public", () => {
      expect(mediaUrlOf("foto.jpg")).toBe(
        "https://backend.test/public/foto.jpg"
      );
    });

    it("sem mediaUrl persistida retorna null", () => {
      expect(mediaUrlOf(null)).toBeNull();
    });
  });

  describe("mediaAuth servindo /media/messaging", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      (verify as jest.Mock).mockReturnValue({ id: "1", companyId: 1 });
    });

    it("autoriza messaging/<mediaUrl> pertencente a propria empresa", async () => {
      const spy = jest
        .spyOn(Message, "findOne")
        .mockResolvedValue({ id: "m-1" } as any);
      const next = jest.fn();

      await mediaAuth(makeReq("/messaging/uuid-foto.jpg"), makeRes(), next);

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { mediaUrl: "messaging/uuid-foto.jpg", companyId: 1 }
        })
      );
      expect(next).toHaveBeenCalled();
      spy.mockRestore();
    });

    it("nega com 404 quando o anexo nao pertence a empresa do token", async () => {
      const spy = jest.spyOn(Message, "findOne").mockResolvedValue(null);
      const res = makeRes();
      const next = jest.fn();

      await mediaAuth(makeReq("/messaging/uuid-alheio.jpg"), res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(404);
      spy.mockRestore();
    });

    it("exige autenticacao (401 sem token)", async () => {
      const req: any = {
        path: "/messaging/uuid-foto.jpg",
        headers: {},
        query: {}
      };
      const res = makeRes();
      const next = jest.fn();

      await mediaAuth(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });
});
