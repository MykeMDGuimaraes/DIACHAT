import { getIO } from "../../../libs/socket";
import { publishTenantEvent } from "../../../libs/tenantEvents";
import emitChannelHealthChanged from "../emitChannelHealthChanged";

jest.mock("../../../libs/socket", () => ({
  getIO: jest.fn()
}));
jest.mock("../../../libs/tenantEvents", () => ({
  publishTenantEvent: jest.fn()
}));

/**
 * Caminho de atualização ao vivo do banner (T5): o evento
 * company-X-whatsapp precisa carregar o canal completo (id + deliveryHealth)
 * para o handler do DeliveryHealthBanner casar e mudar de estado.
 */
describe("emitChannelHealthChanged (T5)", () => {
  const emit = jest.fn();

  beforeEach(() => {
    emit.mockClear();
    (getIO as jest.Mock).mockReturnValue({ emit });
    (publishTenantEvent as jest.Mock).mockClear();
  });

  it("emite company-X-whatsapp com o canal (id + deliveryHealth) que alimenta o banner", () => {
    const channel = { id: 42, companyId: 7, deliveryHealth: "degraded" } as any;

    emitChannelHealthChanged(channel);

    expect(emit).toHaveBeenCalledWith("company-7-whatsapp", {
      action: "update",
      whatsapp: channel
    });
    expect(emit.mock.calls[0][1].whatsapp.id).toBe(42);
    expect(emit.mock.calls[0][1].whatsapp.deliveryHealth).toBe("degraded");
    expect(publishTenantEvent).toHaveBeenCalledWith(7, "whatsapp.updated", {
      whatsappId: 42,
      deliveryHealth: "degraded"
    });
  });
});
