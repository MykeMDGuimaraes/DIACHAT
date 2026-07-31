import { FlowBuilderModel } from "../../models/FlowBuilder";

interface Request {
  companyId: number;
  name: string;
  flowId: number;
}

const UpdateFlowBuilderService = async ({
  companyId,
  name,
  flowId
}: Request): Promise<string> => {
  try {
    const nameExist = await FlowBuilderModel.findOne({
      where: {
        name,
        company_id: companyId
      }
    });

    console.log({ nameExist });

    if (nameExist) {
      return "exist";
    }

    await FlowBuilderModel.update(
      { name },
      {
        where: { id: flowId, company_id: companyId }
      }
    );

    return "ok";
  } catch (error) {
    console.error("Erro ao inserir o usuário:", error);

    return error;
  }
};

export default UpdateFlowBuilderService;
