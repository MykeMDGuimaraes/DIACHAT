import Tag from "../../models/Tag";
import AppError from "../../errors/AppError";

const TagService = async (
  id: string | number,
  companyId: number
): Promise<Tag> => {
  const tag = await Tag.findByPk(id);

  if (!tag || tag.companyId !== companyId) {
    throw new AppError("ERR_NO_TAG_FOUND", 404);
  }

  return tag;
};

export default TagService;
