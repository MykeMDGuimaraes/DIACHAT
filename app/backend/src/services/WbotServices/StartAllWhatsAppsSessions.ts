import * as Sentry from "@sentry/node";
import ListWhatsAppsService from "../WhatsappService/ListWhatsAppsService";
import { StartWhatsAppSession } from "./StartWhatsAppSession";
import { logger } from "../../utils/logger";

// Sessão pareada de verdade: JSON íntegro com creds.me (preenchido pelo
// Baileys após o login). String vazia, JSON parcial/truncado ou creds sem
// `me` (canal criado e nunca pareado) não reconectam no boot — só geram QR
// em loop e disputam recurso com as sessões reais. Canais não pareados são
// iniciados sob demanda pela tela de conexões (StartWhatsAppSession).
const hasPairedCredentials = (raw: unknown): boolean => {
  if (typeof raw !== "string" || !raw.trim()) return false;
  try {
    const parsed = JSON.parse(raw);
    return Boolean(parsed?.creds?.me);
  } catch {
    return false;
  }
};

export const StartAllWhatsAppsSessions = async (
  companyId: number
): Promise<void> => {
  try {
    const whatsapps = await ListWhatsAppsService({ companyId });
    const withCredentials = whatsapps.filter(whatsapp =>
      hasPairedCredentials(whatsapp.session)
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
