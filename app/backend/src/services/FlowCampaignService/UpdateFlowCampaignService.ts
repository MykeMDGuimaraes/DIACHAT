import { FlowCampaignModel } from "../../models/FlowCampaign";

interface Request {
  companyId: number;
  name: string;
  flowId: number;
  phrase: string;
  id: number;
  status: boolean;
}

const UpdateFlowCampaignService = async ({
  companyId: _companyId,
  name,
  flowId,
  phrase,
  id,
  status
}: Request): Promise<string> => {
  try {
    await FlowCampaignModel.update(
      { name, phrase, flowId, status },
      {
        where: { id }
      }
    );

    return "ok";
  } catch (error) {
    console.error("Erro ao inserir o usuário:", error);

    return error;
  }
};

export default UpdateFlowCampaignService;
