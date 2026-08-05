import fs from "fs";
import path from "path";

const read = (relativePath: string): string =>
  fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");

/**
 * Guardas estruturais do Hardening T5 (confirmação de entrega e saúde do canal).
 */
describe("Autoridade única de ACK e saúde de entrega (T5)", () => {
  it("o handleMsgAck legado só delega à cadeia de domínio — sem escrita direta de ack", () => {
    const source = read("../../services/WbotServices/wbotMessageListener.ts");
    const start = source.indexOf("const handleMsgAck");
    const end = source.indexOf("const verifyCampaignMessageAndCloseTicket");
    const handler = source.slice(start, end);

    expect(handler).toContain("acknowledgeBaileysProviderMessage");
    expect(handler).not.toMatch(/\.update\(\{\s*ack/);
    expect(handler).not.toContain("readMessages(");
  });

  it("a saúde do canal muda apenas via ChannelDeliveryHealthService", () => {
    expect(read("../outbox/DeliveryConfirmationRecoveryService.ts")).toContain(
      "recordUnconfirmedDelivery"
    );
    expect(read("../application/BaileysDomainEventService.ts")).toContain(
      "recordConfirmedDelivery"
    );
    // Confirmações Meta Cloud também restauram a saúde do canal (T5).
    expect(read("../channels/meta-cloud/MetaInboxProcessor.ts")).toContain(
      "recordConfirmedDelivery"
    );
  });

  it("o módulo de mensageria não emite socket — a notificação vive no núcleo", () => {
    expect(
      read("../application/ChannelDeliveryHealthService.ts")
    ).not.toContain("libs/socket");
    expect(
      read("../outbox/DeliveryConfirmationRecoveryService.ts")
    ).not.toContain("libs/socket");
  });

  it("a projeção aditiva de entrega é servida no GET e nos dois caminhos de socket", () => {
    expect(
      read("../../services/MessageServices/ListMessagesService.ts")
    ).toContain("attachDeliveryProjection");
    expect(
      read("../../services/MessageServices/CreateMessageService.ts")
    ).toContain("attachDeliveryProjection");
    expect(
      read("../../services/WbotServices/wbotMessageListener.ts")
    ).toContain("attachDeliveryProjection");
  });

  it("o payload do ticket expõe id e deliveryHealth do canal em todos os caminhos da tela", () => {
    const paths = [
      "../../services/TicketServices/ShowTicketService.ts",
      "../../services/TicketServices/ShowTicketFromUUIDService.ts",
      "../../services/TicketServices/ListTicketsService.ts",
      "../../services/TicketServices/ListTicketsServiceKanban.ts",
      "../../controllers/MessageController.ts",
      "../../services/MessageServices/CreateMessageService.ts",
      "../channels/meta-cloud/MetaInboxProcessor.ts"
    ];
    for (const rel of paths) {
      const source = read(rel);
      const include = source.match(
        /model: Whatsapp,\s*as: "whatsapp"[\s\S]*?attributes: \[([^\]]*)\]/
      );
      expect(include).not.toBeNull();
      expect(include![1]).toContain('"id"');
      expect(include![1]).toContain('"deliveryHealth"');
    }
  });
});
