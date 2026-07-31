import { FlowBuilderModel } from "../../models/FlowBuilder";

interface Request {
  userId: number;
  name: string;
  companyId: number;
}

const CreateFlowBuilderService = async ({
  userId,
  name,
  companyId
}: Request): Promise<FlowBuilderModel | string> => {
  try {
    const nameExist = await FlowBuilderModel.findOne({
      where: {
        name,
        company_id: companyId
      }
    });

    if (nameExist) {
      return "exist";
    }

    const flow = await FlowBuilderModel.create({
      user_id: userId,
      company_id: companyId,
      name
    });

    return flow;
  } catch (error) {
    console.error("Erro ao inserir o usuário:", error);

    return error;
  }
};

export default CreateFlowBuilderService;
