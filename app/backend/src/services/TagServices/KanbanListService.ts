import Tag from "../../models/Tag";

interface Request {
  companyId: number;
}

const KanbanListService = async ({ companyId }: Request): Promise<Tag[]> => {
  const tags = await Tag.findAll({
    where: {
      kanban: 1,
      companyId
    },
    order: [["id", "ASC"]],
    raw: true
  });
  return tags;
};

export default KanbanListService;
