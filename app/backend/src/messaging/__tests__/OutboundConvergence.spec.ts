import fs from "fs";
import path from "path";

const repoRoot = path.resolve(__dirname, "../../..");
const readSource = (relativePath: string): string =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

// Comentarios (bloco e linha) nao contam como bypass: os arquivos legados
// tem historico comentado com os padroes antigos.
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("Convergencia de envios no outbox (Task 4)", () => {
  it.each([
    "src/controllers/MessageController.ts",
    "src/controllers/InternalV1Controller.ts",
    "src/services/WebhookService/ActionsWebhookService.ts"
  ])("%s nao contorna o outbox enviando direto pelo socket", relativePath => {
    const source = readSource(relativePath);
    expect(source).not.toMatch(/WbotServices\/SendWhatsAppMessage["']/);
    expect(source).not.toMatch(/WbotServices\/SendWhatsAppMedia["']/);
  });

  it("MessageController nao desvia envios pela fila Bull SendMessage", () => {
    // O consumidor da fila entrega direto no socket (queues.ts ->
    // helpers/SendMessage): qualquer messageQueue.add aqui e um bypass
    // do outbox, inclusive o endpoint legado /api/messages/send.
    const source = readSource("src/controllers/MessageController.ts");
    expect(source).not.toMatch(/messageQueue/);
  });

  it("automacoes nao enviam midia direto pelo SendWhatsAppMediaFlow", () => {
    // Apos a migracao (Task 4), todo fluxo de webhook — texto, imagem,
    // audio (voice note ptt ou arquivo) e video — passa pelo nucleo do
    // outbox; restam apenas utilitarios (typeSimulation, processAudio*).
    const source = readSource(
      "src/services/WebhookService/ActionsWebhookService.ts"
    );
    expect(source).not.toMatch(/\bSendWhatsAppMediaFlow\s*\(/);
    expect(source).not.toMatch(/\bSendMessage\s*\(/);
  });

  it("automacoes nao chamam nem importam nenhum envio direto legado", () => {
    // Qualquer simbolo de envio direto (mesmo em comentario ou codigo
    // morto) e um bypass potencial do outbox: o arquivo fica proibido de
    // mencionar os tres remetentes legados, em chamada ou em import.
    const source = readSource(
      "src/services/WebhookService/ActionsWebhookService.ts"
    );
    expect(source).not.toMatch(/\bSendWhatsAppMessage\s*\(/);
    expect(source).not.toMatch(
      /import\s+(type\s+)?\{[^}]*\bSendWhatsAppMessage\b[^}]*\}\s+from/
    );
    expect(source).not.toMatch(/import\s+SendWhatsAppMessage\s+from/);
    expect(source).not.toMatch(
      /import\s+(type\s+)?\{[^}]*\bSendWhatsAppMediaFlow\b[^}]*\}\s+from/
    );
  });

  it.each([
    "src/services/TicketServices/UpdateTicketService.ts",
    "src/services/WbotServices/wbotClosedTickets.ts",
    "src/services/WbotServices/wbotMessageListener.ts",
    "src/services/IntegrationsServices/OpenAiService.ts",
    "src/services/TypebotServices/typebotListener.ts",
    "src/services/WbotServices/providers.ts",
    "src/queues.ts",
    "src/helpers/SendMessage.ts",
    "src/services/WbotServices/wbotMonitor.ts",
    "src/services/WbotServices/DeleteWhatsAppMessage.ts",
    "src/services/WbotServices/SendWhatsAppMedia.ts",
    "src/services/WbotServices/SendWhatsAppMediaFlow.ts"
  ])(
    "%s: todo envio user-facing passa pelo outbox (sem remetente legado nem socket direto)",
    relativePath => {
      // Politica completa de sinks (Task 4): nesses arquivos, nenhuma
      // referencia ativa ao remetente legado nem envio direto pelo socket
      // Baileys — mensagens so saem via OutboundMessageService. Excecoes
      // de protocolo (nao-mensagem) vivem em wbotMonitor e
      // DeleteWhatsAppMessage e nao usam esses simbolos.
      const source = stripComments(readSource(relativePath));
      expect(source).not.toMatch(/\bSendWhatsAppMessage\b/);
      expect(source).not.toMatch(/\bsendBaileysSocketMessage\s*\(/);
    }
  );

  it("midia remota nunca chega ao Baileys como URL — fetcher anti-SSRF faz staging local", () => {
    const source = stripComments(
      readSource(
        "src/messaging/adapters/baileys/BaileysMessageCommandProvider.ts"
      )
    );
    expect(source).toMatch(/fetchRemoteMediaSecurely/);
    expect(source).not.toMatch(/url:\s*link\b/);
  });

  it("os helpers de midia usados pelo providers.ts sao outbox-backed", () => {
    const source = stripComments(
      readSource("src/services/WbotServices/wbotMessageListener.ts")
    );
    ["sendMessageImage", "sendMessageLink"].forEach(helper => {
      const idx = source.indexOf(`const ${helper}`);
      expect(idx).toBeGreaterThan(-1);
      const body = source.slice(idx, idx + 3000);
      expect(body).toMatch(/outboundMessageService\.create/);
      expect(body).not.toMatch(/sendBaileysSocketMessage/);
    });
  });

  it("a fachada publica nao reexporta o primitivo de envio direto pelo socket", () => {
    // Fronteira de sinks (Task 4): sendBaileysSocketMessage vive apenas nos
    // internals do adapter; o core nao consegue importa-lo — mensagens de
    // saida so nascem via OutboundMessageService. A unica excecao de
    // protocolo exposta e deleteBaileysMessage (revogacao, nao-mensagem).
    const source = stripComments(readSource("src/messaging/public/baileys.ts"));
    expect(source).not.toMatch(/\bsendBaileysSocketMessage\b/);
  });

  it("o Baileys vendorizado honra options.messageId (key.id == commandId; eco fromMe nao duplica)", () => {
    // A correlacao do eco depende de o socket usar o messageId do comando
    // como key.id: a Message upfront (id == commandId) e encontrada pelo
    // Message.count do listener e nunca duplicada.
    const messagesJs = fs.readFileSync(
      path.join(repoRoot, "node_modules/baileys/lib/Utils/messages.js"),
      "utf8"
    );
    expect(messagesJs).toContain("options?.messageId ||");
  });
});
