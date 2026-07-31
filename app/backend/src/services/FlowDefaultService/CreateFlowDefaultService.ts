import { FlowDefaultModel } from "../../models/FlowDefault";

interface Request {
  userId: number;
  companyId: number;
  flowIdWelcome: number;
  flowIdPhrase: number;
}

const CreateFlowDefaultService = async ({
  userId,
  companyId,
  flowIdWelcome,
  flowIdPhrase
}: Request): Promise<FlowDefaultModel> => {
  try {
    const flow = await FlowDefaultModel.create({
      userId,
      companyId,
      flowIdWelcome,
      flowIdNotPhrase: flowIdPhrase
    });

    return flow;
  } catch (error) {
    console.error("Erro ao inserir o usuário:", error);

    return error;
  }
};

export default CreateFlowDefaultService;
