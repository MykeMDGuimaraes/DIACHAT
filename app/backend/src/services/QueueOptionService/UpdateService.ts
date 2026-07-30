import QueueOption from "../../models/QueueOption";
import ShowService from "./ShowService";

interface QueueData {
  queueId?: string;
  title?: string;
  option?: string;
  message?: string;
  parentId?: string;
}

const UpdateService = async (
  queueOptionId: number | string,
  queueOptionData: QueueData,
  companyId: number
): Promise<QueueOption> => {
  const queueOption = await ShowService(queueOptionId, companyId);

  await queueOption.update(queueOptionData as any);

  return queueOption;
};

export default UpdateService;
