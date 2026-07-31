import { WebhookModel } from "../../models/Webhook";

interface Request {
  companyId: number;
  details: {};
  webhookId: number;
}

const UpdateWebHookConfigService = async ({
  companyId,
  details,
  webhookId
}: Request): Promise<string> => {
  try {
    const webhookOld = await WebhookModel.findOne({
      where: {
        company_id: companyId,
        id: webhookId
      }
    });

    const config = { ...webhookOld.config, details };

    await WebhookModel.update(
      { config },
      {
        where: { id: webhookId, company_id: companyId }
      }
    );

    return "ok";
  } catch (error) {
    console.error("Erro ao inserir o usuário:", error);

    return error;
  }
};

export default UpdateWebHookConfigService;
