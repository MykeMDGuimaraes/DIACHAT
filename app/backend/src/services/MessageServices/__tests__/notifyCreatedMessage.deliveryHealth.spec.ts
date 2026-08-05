import { getIO } from "../../../libs/socket";
import { notifyCreatedMessage } from "../CreateMessageService";

jest.mock("../../../libs/socket", () => ({ getIO: jest.fn() }));
jest.mock("../../../libs/tenantEvents", () => ({
  publishTenantEvent: jest.fn()
}));
jest.mock("../../../messaging/public/delivery", () => ({
  attachDeliveryProjection: jest.fn().mockResolvedValue(undefined)
}));
jest.mock("../../../messaging/public/domainEvents", () => ({
  publishPersistedBaileysMessageEvents: jest.fn()
}));

/**
 * Contrato comportamental do payload emitido (T5): a mensagem criada via
 * qualquer provedor (inclusive Meta Cloud, cujo ticket é carregado pelo
 * MetaInboxProcessor) precisa chegar ao socket com whatsapp.id +
 * deliveryHealth — é com esses campos que o banner de canal degradado casa
 * o canal e muda de estado ao vivo.
 */
describe("notifyCreatedMessage — contrato de saúde do canal (T5)", () => {
  it("carrega whatsapp.id + deliveryHealth no payload appMessage do socket", async () => {
    const emit = jest.fn();
    // io.to(a).to(b).to(c).emit(...): cada .to() devolve o mesmo encadeável.
    const chained: { emit: jest.Mock; to: jest.Mock } = {
      emit,
      to: jest.fn()
    };
    chained.to.mockReturnValue(chained);
    (getIO as jest.Mock).mockReturnValue(chained);
    const message = {
      id: "meta-msg-1",
      ticketId: 99,
      companyId: 7,
      fromMe: false,
      ticket: {
        id: 99,
        status: "open",
        contact: { id: 1, number: "55119990000" },
        whatsapp: { id: 42, name: "Canal Meta", deliveryHealth: "degraded" }
      }
    } as any;

    await notifyCreatedMessage(message, 7);

    const appMessageCall = emit.mock.calls.find(([event]) =>
      String(event).includes("appMessage")
    );
    expect(appMessageCall).toBeTruthy();
    expect(appMessageCall[1].message.ticket.whatsapp).toMatchObject({
      id: 42,
      name: "Canal Meta",
      deliveryHealth: "degraded"
    });
  });
});
