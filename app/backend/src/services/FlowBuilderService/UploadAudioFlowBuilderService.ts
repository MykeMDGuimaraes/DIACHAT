import { FlowAudioModel } from "../../models/FlowAudio";

interface Request {
  userId: number;
  name: string;
  companyId: number;
}

const UploadAudioFlowBuilderService = async ({
  userId,
  name,
  companyId
}: Request): Promise<FlowAudioModel> => {
  try {
    const flowImg = await FlowAudioModel.create({
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

export default UploadAudioFlowBuilderService;
