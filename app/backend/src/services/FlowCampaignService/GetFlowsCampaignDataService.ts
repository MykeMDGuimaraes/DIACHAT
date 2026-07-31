import { FlowCampaignModel } from "../../models/FlowCampaign";

interface Request {
  companyId: number;
  idFlow: number;
}

interface Response {
  details: FlowCampaignModel;
}

const GetFlowsCampaignDataService = async ({
  companyId: _companyId,
  idFlow
}: Request): Promise<Response> => {
  try {
    // Realiza a consulta com paginação usando findAndCountAll
    const { rows } = await FlowCampaignModel.findAndCountAll({
      where: {
        id: idFlow
      }
    });

    const hook = rows[0];

    return {
      details: hook
    };
  } catch (error) {
    console.error("Erro ao consultar Fluxo:", error);
  }
};

export default GetFlowsCampaignDataService;
