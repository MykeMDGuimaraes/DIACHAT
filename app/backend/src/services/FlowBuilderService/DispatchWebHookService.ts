import { WebhookModel } from "../../models/Webhook";

interface Request {
  userId: number;
  hashId: string;
  data: any;
}

const DispatchWebHookService = async ({
  userId,
  hashId,
  data
}: Request): Promise<WebhookModel> => {
  try {
    const webhook = await WebhookModel.findOne({
      where: {
        user_id: userId,
        hash_id: hashId
      }
    });

    const config = {
      lastRequest: {
        ...data
      }
    };

    await WebhookModel.update(
      { config },
      {
        where: { hash_id: hashId, user_id: userId }
      }
    );

    return webhook;
  } catch (error) {
    console.error("Erro ao inserir o usuário:", error);

    return error;
  }
};

export default DispatchWebHookService;
