import Chat from "../../models/Chat";
import AppError from "../../errors/AppError";

const ShowFromUuidService = async (
  uuid: string,
  companyId: number
): Promise<Chat> => {
  const record = await Chat.findOne({ where: { uuid, companyId } });

  if (!record || record.companyId !== companyId) {
    throw new AppError("ERR_NO_CHAT_FOUND", 404);
  }

  return record;
};

export default ShowFromUuidService;
