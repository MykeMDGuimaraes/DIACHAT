import { FlowBuilderModel } from "../../models/FlowBuilder";

interface node {
  id: string;
  position: { x: number; y: number };
  data: {
    label: string;
    sec?: number;
    title?: string;
    text?: string;
  };
  type: string;
  style: { backgroundColor: string; color: string };
}

interface body {
  nodes: node;
  idFlow: number;
  connections: any;
}

interface Request {
  companyId: number;
  bodyData: body;
}

const FlowUpdateDataService = async ({
  companyId,
  bodyData
}: Request): Promise<string> => {
  try {
    await FlowBuilderModel.update(
      {
        flow: {
          nodes: bodyData.nodes,
          connections: bodyData.connections
        }
      },
      {
        where: { id: bodyData.idFlow, company_id: companyId }
      }
    );

    return "ok";
  } catch (error) {
    console.error("Erro ao inserir o usuário:", error);

    return error;
  }
};

export default FlowUpdateDataService;
