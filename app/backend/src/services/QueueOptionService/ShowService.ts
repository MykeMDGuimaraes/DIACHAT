import AppError from "../../errors/AppError";
import QueueOption from "../../models/QueueOption";
import Queue from "../../models/Queue";

const ShowService = async (
  queueOptionId: number | string,
  companyId: number
): Promise<QueueOption> => {
  const queue = await QueueOption.findOne({
    where: {
      id: queueOptionId
    },
    include: [
      {
        model: QueueOption,
        as: 'parent',
        where: { parentId: queueOptionId },
        required: false
      },
      {
        model: Queue,
        attributes: ["id", "companyId"]
      }
    ]
  });

  if (!queue || queue.queue?.companyId !== companyId) {
    throw new AppError("ERR_QUEUE_NOT_FOUND");
  }

  return queue;
};

export default ShowService;
