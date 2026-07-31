import { Request, Response } from "express";
import CreateFlowCampaignService from "../services/FlowCampaignService/CreateFlowCampaignService";
import FlowsCampaignGetDataService from "../services/FlowCampaignService/FlowsCampaignGetDataService";
import GetFlowsCampaignDataService from "../services/FlowCampaignService/GetFlowsCampaignDataService";
import DeleteFlowCampaignService from "../services/FlowCampaignService/DeleteFlowCampaignService";
import UpdateFlowCampaignService from "../services/FlowCampaignService/UpdateFlowCampaignService";
// import { handleMessage } from "../services/FacebookServices/facebookMessageListener";

export const createFlowCampaign = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { name, flowId, phrase, whatsappId } = req.body;
  const userId = parseInt(req.user.id);
  const { companyId } = req.user;

  const flow = await CreateFlowCampaignService({
    userId,
    name,
    companyId,
    flowId,
    whatsappId,
    phrase
  });

  return res.status(200).json(flow);
};

export const flowCampaigns = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;

  const flow = await FlowsCampaignGetDataService({
    companyId
  });

  return res.status(200).json(flow);
};

export const flowCampaign = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { idFlow } = req.params;
  const { companyId } = req.user;

  const id = parseInt(idFlow);

  const flow = await GetFlowsCampaignDataService({
    companyId,
    idFlow: id
  });

  return res.status(200).json(flow);
};

export const updateFlowCampaign = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const { flowId, name, phrase, id, status } = req.body;

  const flow = await UpdateFlowCampaignService({
    companyId,
    name,
    flowId,
    phrase,
    id,
    status
  });

  return res.status(200).json(flow);
};

export const deleteFlowCampaign = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { idFlow } = req.params;

  const flowIdInt = parseInt(idFlow);

  const flow = await DeleteFlowCampaignService(flowIdInt);

  return res.status(200).json(flow);
};
