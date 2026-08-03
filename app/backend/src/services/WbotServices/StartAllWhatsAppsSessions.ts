import * as Sentry from "@sentry/node";
import ListWhatsAppsService from "../WhatsappService/ListWhatsAppsService";
import { StartWhatsAppSession } from "./StartWhatsAppSession";
import { logger } from "../../utils/logger";

export const StartAllWhatsAppsSessions = async (
  companyId: number
): Promise<void> => {
  try {
    const whatsapps = await ListWhatsAppsService({ companyId });
    // Sessão sem credencial salva nunca reconecta no boot — só gera QR em
    // loop e disputa recurso com as sessões reais. Canais não pareados são
    // iniciados sob demanda pela tela de conexões (StartWhatsAppSession).
    const withCredentials = whatsapps.filter(
      whatsapp =>
        typeof whatsapp.session === "string" &&
        whatsapp.session.trim().length > 0
    );
    const skipped = whatsapps.length - withCredentials.length;
    if (skipped > 0) {
      logger.info(
        { companyId, skipped },
        "StartAllWhatsAppsSessions: sessoes sem credencial ignoradas no boot"
      );
    }
    withCredentials.forEach(whatsapp => {
      StartWhatsAppSession(whatsapp, companyId);
    });
  } catch (e) {
    Sentry.captureException(e);
  }
};
