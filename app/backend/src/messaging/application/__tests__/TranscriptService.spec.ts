import AppError from "../../../errors/AppError";
import TranscriptService, {
  decodeTranscriptCursor
} from "../TranscriptService";

const message = (id: string, createdAt: string, overrides = {}) => ({
  id,
  ticketId: 11,
  contactId: 22,
  fromMe: false,
  body: "conteudo",
  mediaType: null,
  ack: 1,
  read: false,
  isDeleted: false,
  createdAt: new Date(createdAt),
  dataJson: "{}",
  getDataValue: jest.fn().mockReturnValue(null),
  ...overrides
});

describe("TranscriptService", () => {
  it("isolates the transcript by company and allowed connection", async () => {
    const dependencies = {
      findTicket: jest.fn().mockResolvedValue({
        id: 11,
        uuid: "conversation-uuid",
        companyId: 7,
        whatsappId: 2
      }),
      findMessages: jest.fn().mockResolvedValue([
        message("m2", "2026-07-28T20:01:00.000Z"),
        message("m1", "2026-07-28T20:00:00.000Z")
      ]),
      signAttachment: jest.fn()
    };
    const service = new TranscriptService(dependencies as any);

    const result = await service.list({
      companyId: 7,
      allowedConnectionIds: [2],
      conversationId: "conversation-uuid",
      limit: 1
    });

    expect(dependencies.findTicket).toHaveBeenCalledWith(
      "conversation-uuid",
      7
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        id: "m2",
        conversationId: "conversation-uuid",
        actorType: "contact",
        status: "received"
      })
    );
    expect(decodeTranscriptCursor(result.nextCursor!)).toEqual({
      createdAt: "2026-07-28T20:01:00.000Z",
      id: "m2"
    });
  });

  it("classifies API and human outbound authorship and signs attachments", async () => {
    const dependencies = {
      findTicket: jest.fn().mockResolvedValue({
        id: 11,
        uuid: "conversation-uuid",
        companyId: 7,
        whatsappId: 2
      }),
      findMessages: jest.fn().mockResolvedValue([
        message("api", "2026-07-28T20:01:00.000Z", {
          fromMe: true,
          ack: 3,
          dataJson: JSON.stringify({ origin: "api" }),
          mediaType: "image",
          getDataValue: jest.fn().mockReturnValue("image.png")
        }),
        message("human", "2026-07-28T20:00:00.000Z", {
          fromMe: true,
          ack: 2
        })
      ]),
      signAttachment: jest
        .fn()
        .mockReturnValue("/api/v1/transcript/media/api?expires=1&signature=x")
    };
    const service = new TranscriptService(dependencies as any);

    const result = await service.list({
      companyId: 7,
      allowedConnectionIds: [2],
      conversationId: "conversation-uuid"
    });

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        actorType: "automation",
        status: "delivered",
        attachmentUrl:
          "/api/v1/transcript/media/api?expires=1&signature=x"
      })
    );
    expect(result.items[1].actorType).toBe("human");
  });

  it("rejects a conversation outside the credential connection boundary", async () => {
    const service = new TranscriptService({
      findTicket: jest.fn().mockResolvedValue({
        id: 11,
        uuid: "conversation-uuid",
        companyId: 7,
        whatsappId: 99
      }),
      findMessages: jest.fn(),
      signAttachment: jest.fn()
    } as any);

    await expect(
      service.list({
        companyId: 7,
        allowedConnectionIds: [2],
        conversationId: "conversation-uuid"
      })
    ).rejects.toEqual(expect.objectContaining({ statusCode: 404 }));
  });
});
