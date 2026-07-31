import { WebhookModel } from "../../models/Webhook";

interface Request {
  status: boolean;
  webhookId: number;
}

const UpdateActiveWebHookService = async ({
  status,
  webhookId
}: Request): Promise<string> => {
  try {
    await WebhookModel.update(
      { active: status },
      {
        where: { id: webhookId }
      }
    );

    return "ok";
  } catch (error) {
    console.error("Erro ao inserir o usuário:", error);

    return error;
  }
};

export default UpdateActiveWebHookService;
