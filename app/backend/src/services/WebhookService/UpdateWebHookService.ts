import { WebhookModel } from "../../models/Webhook";

interface Request {
  userId: number;
  name: string;
  companyId: number;
  webhookId: number;
}

const UpdateWebHookService = async ({
  userId,
  name,
  companyId,
  webhookId
}: Request): Promise<string> => {
  try {
    const nameExist = await WebhookModel.findOne({
      where: {
        name,
        company_id: companyId
      }
    });

    if (nameExist) {
      return "exist";
    }

    await WebhookModel.update(
      { name },
      {
        where: { id: webhookId, user_id: userId }
      }
    );

    return "ok";
  } catch (error) {
    console.error("Erro ao inserir o usuário:", error);

    return error;
  }
};

export default UpdateWebHookService;
