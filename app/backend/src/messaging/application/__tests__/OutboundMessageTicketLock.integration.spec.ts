import sequelize from "../../../database";
import OutboundMessageService from "../OutboundMessageService";

// Guarda de regressao: as consultas travadas do envio (FOR UPDATE) incluem
// Contact via LEFT JOIN; o PostgreSQL recusa travar o lado nulavel do join
// (erro 0A000) e o envio pelo painel virava 500. Estas specs rodam contra o
// Postgres real — as specs unitarias injetam dependencias mockadas e nunca
// exercitam o SQL gerado.

const refs = { companyId: 0, whatsappId: 0, contactId: 0, ticketId: 0 };

jest.setTimeout(15_000);

// Acesso as dependencias padrao (banco real) para exercitar a consulta SQL.
const defaultDependencies = (): any =>
  (new OutboundMessageService() as any).dependencies;

describe("OutboundMessageService — trava de ticket com join (banco real)", () => {
  beforeAll(async () => {
    const [companies] = await sequelize.query(
      `INSERT INTO "Companies" ("name", "createdAt", "updatedAt")
       VALUES ('Empresa Lock ' || gen_random_uuid(), NOW(), NOW()) RETURNING "id"`
    );
    refs.companyId = (companies as Array<{ id: number }>)[0].id;
    const [whatsapps] = await sequelize.query(
      `INSERT INTO "Whatsapps" ("name", "status", "companyId", "createdAt", "updatedAt")
       VALUES ('Canal Lock ' || gen_random_uuid(), 'CONNECTED', ${refs.companyId}, NOW(), NOW()) RETURNING "id"`
    );
    refs.whatsappId = (whatsapps as Array<{ id: number }>)[0].id;
    const [contacts] = await sequelize.query(
      `INSERT INTO "Contacts" ("name", "number", "companyId", "createdAt", "updatedAt")
       VALUES ('Contato Lock ' || gen_random_uuid(), '5511999999999', ${refs.companyId}, NOW(), NOW()) RETURNING "id"`
    );
    refs.contactId = (contacts as Array<{ id: number }>)[0].id;
    const [tickets] = await sequelize.query(
      `INSERT INTO "Tickets" ("status", "contactId", "whatsappId", "companyId", "createdAt", "updatedAt")
       VALUES ('open', ${refs.contactId}, ${refs.whatsappId}, ${refs.companyId}, NOW(), NOW()) RETURNING "id"`
    );
    refs.ticketId = (tickets as Array<{ id: number }>)[0].id;
  });

  afterAll(async () => {
    await sequelize.query(
      `DELETE FROM "Tickets" WHERE "id" = ${refs.ticketId}`
    );
    await sequelize.query(
      `DELETE FROM "Contacts" WHERE "id" = ${refs.contactId}`
    );
    await sequelize.query(
      `DELETE FROM "Whatsapps" WHERE "id" = ${refs.whatsappId}`
    );
    await sequelize.query(
      `DELETE FROM "Companies" WHERE "id" = ${refs.companyId}`
    );
    await sequelize.close();
  });

  it("findTicketById trava o Ticket com Contact incluido sem erro 0A000", async () => {
    await sequelize.transaction(async transaction => {
      const ticket = await defaultDependencies().findTicketById(
        refs.ticketId,
        refs.companyId,
        transaction
      );
      expect(ticket).toBeTruthy();
      expect(ticket.contact?.id).toBe(refs.contactId);
    });
  });

  it("findOpenTicket trava o Ticket aberto com Contact incluido sem erro 0A000", async () => {
    await sequelize.transaction(async transaction => {
      const ticket = await defaultDependencies().findOpenTicket(
        refs.contactId,
        refs.whatsappId,
        refs.companyId,
        transaction
      );
      expect(ticket?.id).toBe(refs.ticketId);
      expect(ticket?.contact?.id).toBe(refs.contactId);
    });
  });
});
