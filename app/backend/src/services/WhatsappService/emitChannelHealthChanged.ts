import { getIO } from "../../libs/socket";
import { publishTenantEvent } from "../../libs/tenantEvents";
import Whatsapp from "../../models/Whatsapp";

/**
 * Notificação pós-commit da mudança de saúde de entrega do canal (Hardening
 * T5). O módulo de mensageria não pode emitir socket (fronteira
 * core<->messaging): ele devolve o canal cuja saúde mudou e o núcleo emite —
 * atualiza o banner do frontend (hook de canais) e os consumidores da API
 * interna. Chamar SOMENTE depois do commit da transação que mudou a saúde.
 */
const emitChannelHealthChanged = (channel: Whatsapp): void => {
  getIO().emit(`company-${channel.companyId}-whatsapp`, {
    action: "update",
    whatsapp: channel
  });
  publishTenantEvent(channel.companyId, "whatsapp.updated", {
    whatsappId: channel.id,
    deliveryHealth: channel.deliveryHealth
  });
};

export default emitChannelHealthChanged;
