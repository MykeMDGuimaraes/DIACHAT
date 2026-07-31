import { WebhookModel } from "../../models/Webhook";

interface Request {
  companyId: number;
  hashId: string;
}

interface Response {
  webhook: WebhookModel;
}

const GetWebHookService = async ({
  companyId,
  hashId
}: Request): Promise<Response> => {
  try {
    // Realiza a consulta com paginação usando findAndCountAll
    const { rows } = await WebhookModel.findAndCountAll({
      where: {
        company_id: companyId,
        hash_id: hashId
      }
    });
    const hook = rows[0];

    return {
      webhook: hook
    };
  } catch (error) {
    console.error("Erro ao consultar usuários:", error);
  }
};

export default GetWebHookService;
