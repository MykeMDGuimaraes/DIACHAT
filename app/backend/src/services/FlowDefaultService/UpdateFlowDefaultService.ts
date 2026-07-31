import { FlowDefaultModel } from "../../models/FlowDefault";

interface Request {
  companyId: number;
  flowIdWelcome: number;
  flowIdPhrase: number;
}

const UpdateFlowDefaultService = async ({
  companyId,
  flowIdWelcome,
  flowIdPhrase
}: Request): Promise<string> => {
  try {
    await FlowDefaultModel.update(
      { flowIdWelcome, flowIdNotPhrase: flowIdPhrase },
      {
        where: { companyId }
      }
    );

    return "ok";
  } catch (error) {
    console.error("Erro ao inserir o usuário:", error);

    return error;
  }
};

export default UpdateFlowDefaultService;
