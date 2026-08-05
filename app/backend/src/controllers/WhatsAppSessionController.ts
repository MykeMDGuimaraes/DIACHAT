import { Request, Response } from "express";
import ShowWhatsAppService from "../services/WhatsappService/ShowWhatsAppService";
import { StartWhatsAppSession } from "../services/WbotServices/StartWhatsAppSession";
import UpdateWhatsAppService from "../services/WhatsappService/UpdateWhatsAppService";
import { getSessionManager } from "../services/WbotServices/WhatsAppSessionManager";
import { logger } from "../utils/logger";

const store = async (req: Request, res: Response): Promise<Response> => {
  const { whatsappId } = req.params;
  const { companyId } = req.user;

  const whatsapp = await ShowWhatsAppService(whatsappId, companyId);
  // Conectar: single-flight do manager (cliques repetidos compartilham a
  // mesma tentativa de conexao).
  await StartWhatsAppSession(whatsapp, companyId);

  return res.status(200).json({ message: "Starting session." });
};

const update = async (req: Request, res: Response): Promise<Response> => {
  const { whatsappId } = req.params;
  const { companyId } = req.user;

  const { whatsapp } = await UpdateWhatsAppService({
    whatsappId,
    companyId,
    whatsappData: { session: "" }
  });

  // Re-pareamento: geracao nova derruba a vigente; callbacks e listeners da
  // geracao antiga ficam inertes.
  await StartWhatsAppSession(whatsapp, companyId, { replace: true });

  return res.status(200).json({ message: "Starting session." });
};

const remove = async (req: Request, res: Response): Promise<Response> => {
  const { whatsappId } = req.params;
  const { companyId } = req.user;
  const whatsapp = await ShowWhatsAppService(whatsappId, companyId);

  if (whatsapp.session) {
    // Logout serializado pelo manager (teardown do socket + lease +
    // reconexoes tardias revogadas); a credencial sai do banco em seguida.
    // Sem getWbot().logout() direto.
    try {
      await getSessionManager().stop(whatsapp.id, "logout");
    } catch (err) {
      logger.error(err);
    }
    await whatsapp.update({ status: "DISCONNECTED", session: "" });
  }

  return res.status(200).json({ message: "Session disconnected." });
};

export default { store, remove, update };
