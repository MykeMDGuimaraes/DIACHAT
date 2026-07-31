import { FlowImgModel } from "../../models/FlowImg";

interface Request {
  userId: number;
  name: string;
  companyId: number;
}

const UploadImgFlowBuilderService = async ({
  userId,
  name,
  companyId
}: Request): Promise<FlowImgModel> => {
  try {
    const flowImg = await FlowImgModel.create({
      userId,
      companyId,
      name
    });

    return flowImg;
  } catch (error) {
    console.error("Erro ao inserir o usuário:", error);

    return error;
  }
};

export default UploadImgFlowBuilderService;
