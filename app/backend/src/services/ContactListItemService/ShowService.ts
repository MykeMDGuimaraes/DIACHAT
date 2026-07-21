import ContactListItem from "../../models/ContactListItem";
import AppError from "../../errors/AppError";

const ShowService = async (
  id: string | number,
  companyId: number
): Promise<ContactListItem> => {
  const record = await ContactListItem.findByPk(id);

  if (!record || record.companyId !== companyId) {
    throw new AppError("ERR_NO_CONTACTLISTITEM_FOUND", 404);
  }

  return record;
};

export default ShowService;
