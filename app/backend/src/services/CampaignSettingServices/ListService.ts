import CampaignSetting from "../../models/CampaignSetting";

interface Request {
  companyId: number | string;
  searchParam?: string;
  pageNumber?: string;
}

const ListService = async ({
  companyId
}: Request): Promise<CampaignSetting[]> => {
  const whereCondition: any = {
    companyId
  };

  const records = await CampaignSetting.findAll({
    where: whereCondition
  });

  return records;
};

export default ListService;
