import sequelize from "../../../database";
import Contact from "../../../models/Contact";
import Ticket from "../../../models/Ticket";
import Whatsapp from "../../../models/Whatsapp";
import ShowTicketService from "../ShowTicketService";

/**
 * Contrato do payload de saúde do canal (Hardening T5): o ticket que alimenta
 * a tela de atendimento precisa expor id + deliveryHealth do canal — sem isso
 * o banner de canal degradado não tem o que exibir nem com o que casar o
 * evento de socket.
 */
describe("ShowTicketService — contrato de saúde do canal (T5)", () => {
  const suffix = String(Date.now()).slice(-6);
  const created: {
    ticket?: Ticket;
    contact?: Contact;
    whatsapp?: Whatsapp;
  } = {};

  afterAll(async () => {
    if (created.ticket) await created.ticket.destroy({ force: true });
    if (created.contact) await created.contact.destroy({ force: true });
    if (created.whatsapp) await created.whatsapp.destroy({ force: true });
    // Fecha a conexão: sem isto o jest não encerra (handle aberto).
    await sequelize.close();
  });

  it("expõe id e deliveryHealth do canal para o banner aparecer quando degradado", async () => {
    created.whatsapp = await Whatsapp.create({
      name: `Canal Degradado T5 ${suffix}`,
      companyId: 1,
      deliveryHealth: "degraded"
    } as any);
    created.contact = await Contact.create({
      name: `Contato T5 ${suffix}`,
      number: `5511999${suffix}`,
      companyId: 1
    } as any);
    created.ticket = await Ticket.create({
      companyId: 1,
      contactId: created.contact.id,
      whatsappId: created.whatsapp.id,
      status: "open"
    } as any);

    const ticket = await ShowTicketService(created.ticket.id, 1);

    expect(ticket.whatsapp).toMatchObject({
      id: created.whatsapp.id,
      name: `Canal Degradado T5 ${suffix}`,
      deliveryHealth: "degraded"
    });
  });
});
