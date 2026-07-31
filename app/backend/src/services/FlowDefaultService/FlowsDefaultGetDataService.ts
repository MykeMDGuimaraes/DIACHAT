import { FlowDefaultModel } from "../../models/FlowDefault";

interface Request {
  companyId: number;
}

interface Response {
  flow: FlowDefaultModel;
}

const FlowsDefaultGetDataService = async ({
  companyId
}: Request): Promise<Response> => {
  try {
    // Realiza a consulta com paginação usando findAndCountAll
    const { rows } = await FlowDefaultModel.findAndCountAll({
      where: {
        companyId
      }
    });

    const flowResult = [];
    rows.forEach(flow => {
      flowResult.push(flow.toJSON());
    });

    return {
      flow: flowResult[0]
    };
  } catch (error) {
    console.error("Erro ao consultar Fluxo:", error);
  }
};

export default FlowsDefaultGetDataService;
