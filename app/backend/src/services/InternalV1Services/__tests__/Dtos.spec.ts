import Message from "../../../models/Message";
import { toConversationMessageDTO } from "../Dtos";

/**
 * Contrato de URL de midia no DTO da API interna (Task 4): o DTO delega ao
 * getter Message.mediaUrl — midia staged do outbox ("messaging/...") sai pelo
 * mount autenticado /media (nao existe em /public); legado segue em /public.
 */
describe("toConversationMessageDTO — contrato de URL de midia", () => {
  const mediaUrlGetter = Object.getOwnPropertyDescriptor(
    Message.prototype,
    "mediaUrl"
  )!.get!;

  const base = {
    id: "m1",
    ticketId: 7,
    fromMe: true,
    body: "",
    mediaType: "image",
    ack: 1,
    read: false,
    isDeleted: false,
    isEdited: false,
    quotedMsgId: null,
    contactId: 1,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z")
  };

  beforeEach(() => {
    process.env.BACKEND_URL = "https://backend.test";
  });

  it("midia staged (messaging/...) sai pelo mount /media", () => {
    const fakeModel = { getDataValue: () => "messaging/abc.jpg" };
    const dto = toConversationMessageDTO({
      ...base,
      mediaUrl: mediaUrlGetter.call(fakeModel)
    } as any);

    expect(dto.mediaUrl).toBe("https://backend.test/media/messaging/abc.jpg");
    expect(dto.mediaUrl).not.toContain("/public/");
  });

  it("midia legada segue em /public", () => {
    const fakeModel = { getDataValue: () => "1/photo.jpg" };
    const dto = toConversationMessageDTO({
      ...base,
      mediaUrl: mediaUrlGetter.call(fakeModel)
    } as any);

    expect(dto.mediaUrl).toBe("https://backend.test/public/1/photo.jpg");
  });

  it("mensagem sem midia retorna mediaUrl nulo", () => {
    const dto = toConversationMessageDTO({
      ...base,
      mediaType: null,
      mediaUrl: null
    } as any);

    expect(dto.mediaUrl).toBeNull();
  });
});
