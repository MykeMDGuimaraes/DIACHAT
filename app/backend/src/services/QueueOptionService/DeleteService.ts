import ShowService from "./ShowService";

const DeleteService = async (
  queueOptionId: number | string,
  companyId: number
): Promise<void> => {
  const queueOption = await ShowService(queueOptionId, companyId);

  await queueOption.destroy();
};

export default DeleteService;
