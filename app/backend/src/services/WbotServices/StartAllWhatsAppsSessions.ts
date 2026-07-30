import * as Sentry from "@sentry/node";
import ListWhatsAppsService from "../WhatsappService/ListWhatsAppsService";
import { StartWhatsAppSession } from "./StartWhatsAppSession";

export const StartAllWhatsAppsSessions = async (
  companyId: number
): Promise<void> => {
  try {
    const whatsapps = await ListWhatsAppsService({ companyId });
    if (whatsapps.length > 0) {
      whatsapps.forEach(whatsapp => {
        StartWhatsAppSession(whatsapp, companyId);
      });
    }
  } catch (e) {
    Sentry.captureException(e);
  }
};
