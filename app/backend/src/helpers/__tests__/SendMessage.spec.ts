/**
 * Regressao (Task 4): o entry point legado SendMessage (consumido pelo
 * Bull queue handleSendMessage e pelo agendador) nao envia mais direto
 * pelo socket — todo chamado cria um comando no outbox.
 */
const mockCreate = jest.fn();
const mockStage = jest.fn();
const mockKindForFile = jest.fn();

jest.mock("../../messaging/public/outbound", () => ({
  OutboundMessageService: jest.fn().mockImplementation(() => ({
    create: mockCreate
  })),
  stageMessagingMedia: (absolutePath: string, fileName: string) =>
    mockStage(absolutePath, fileName),
  messageKindForFile: (fileName: string) => mockKindForFile(fileName)
}));

// eslint-disable-next-line import/first
import { SendMessage } from "../SendMessage";

describe("SendMessage (entry point legado) — converge para o outbox", () => {
  const whatsapp = { id: 7, companyId: 3 } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("texto cria comando no outbox com prefixo de paridade", async () => {
    mockCreate.mockResolvedValue({ id: "cmd-1" });

    const result = await SendMessage(whatsapp, {
      number: "5511999999999",
      body: "oi"
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 3,
        whatsappId: 7,
        recipient: "5511999999999",
        idempotencyScope: "legacy-queue-send",
        idempotencyKey: expect.any(String),
        kind: "text",
        text: "\u200e oi",
        origin: "automation"
      })
    );
    expect(result).toEqual({ id: "cmd-1" });
  });

  it("midia faz staging do arquivo e cria comando com localPath", async () => {
    mockStage.mockResolvedValue("messaging/abc.pdf");
    mockKindForFile.mockReturnValue("document");
    mockCreate.mockResolvedValue({ id: "cmd-2" });

    await SendMessage(whatsapp, {
      number: 5511999999999,
      body: "legenda",
      mediaPath: "/tmp/x.pdf",
      fileName: "x.pdf"
    });

    expect(mockStage).toHaveBeenCalledWith("/tmp/x.pdf", "x.pdf");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: "5511999999999",
        idempotencyScope: "legacy-queue-send",
        kind: "document",
        payload: {
          localPath: "messaging/abc.pdf",
          fileName: "x.pdf",
          caption: "legenda"
        },
        origin: "automation"
      })
    );
  });
});
