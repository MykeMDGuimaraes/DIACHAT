import { FlowBuilderModel } from "../../models/FlowBuilder";
import { FlowCampaignModel } from "../../models/FlowCampaign";
import { WebhookModel } from "../../models/Webhook";
import { randomString } from "../../utils/randomCode";

interface Request {
  userId: number;
  name: string;
  companyId: number;
  flowId: number;
  phrase: string;
  whatsappId: string;
}

const CreateFlowCampaignService = async ({
  userId,
  name,
  companyId,
  phrase,
  whatsappId,
  flowId
}: Request): Promise<FlowCampaignModel> => {
  try {
    const flow = await FlowCampaignModel.create({
      userId,
      companyId: Number(companyId),
      name,
      phrase,
      flowId,
      whatsappId
    } as any);

    return flow;
  } catch (error) {
    console.error("Erro ao inserir o usuário:", error);

    return error;
  }
};

export default CreateFlowCampaignService;
