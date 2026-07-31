import { FlowAudioModel } from "../../models/FlowAudio";
import { FlowImgModel } from "../../models/FlowImg";

interface Request {
  userId: number;
  medias: Express.Multer.File[];
  companyId: number;
}

const UploadAllFlowBuilderService = async ({
  userId,
  medias,
  companyId
}: Request): Promise<string[]> => {
  try {
    let itemsNewNames: string[] = [];
    for (let i = 0; medias.length > i; i++) {
      let nameFile = medias[i].filename;
      // if (medias[i].filename.split(".").length === 1) {
      //  nameFile = medias[i].filename + "." + medias[i].mimetype.split("/")[1];
      // }
      itemsNewNames = [...itemsNewNames, nameFile];
      if (
        medias[i].mimetype.split("/")[1] === "png" ||
        medias[i].mimetype.split("/")[1] === "jpg" ||
        medias[i].mimetype.split("/")[1] === "jpeg"
      ) {
        await FlowImgModel.create({
          userId,
          companyId,
          name: nameFile
        });
      }
      if (
        medias[i].mimetype.split("/")[1] === "mp3" ||
        medias[i].mimetype.split("/")[1] === "ogg" ||
        medias[i].mimetype.split("/")[1] === "mp4" ||
        medias[i].mimetype.split("/")[1] === "mpeg"
      ) {
        if (medias[i].mimetype.split("/")[1] === "mpeg") {
          nameFile = `${nameFile.split(".")[0]}.mp3`;
        }

        await FlowAudioModel.create({
          userId,
          companyId,
          name: nameFile
        });
      }
    }

    return itemsNewNames;
  } catch (error) {
    console.error("Erro ao inserir o usuário:", error);

    return error;
  }
};

export default UploadAllFlowBuilderService;
