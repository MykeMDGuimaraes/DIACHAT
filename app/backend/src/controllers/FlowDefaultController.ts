import { Request, Response } from "express";
import CreateFlowDefaultService from "../services/FlowDefaultService/CreateFlowDefaultService";
import UpdateFlowDefaultService from "../services/FlowDefaultService/UpdateFlowDefaultService";
import FlowsDefaultGetDataService from "../services/FlowDefaultService/FlowsDefaultGetDataService";
// import { handleMessage } from "../services/FacebookServices/facebookMessageListener";

export const createFlowDefault = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { flowIdWelcome, flowIdPhrase } = req.body;
  const userId = parseInt(req.user.id);
  const { companyId } = req.user;

  const flow = await CreateFlowDefaultService({
    userId,
    companyId,
    flowIdWelcome,
    flowIdPhrase
  });

  return res.status(200).json(flow);
};

export const updateFlow = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const { flowIdWelcome, flowIdPhrase } = req.body;

  const flow = await UpdateFlowDefaultService({
    companyId,
    flowIdWelcome,
    flowIdPhrase
  });

  return res.status(200).json(flow);
};

export const getFlows = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;

  const flows = await FlowsDefaultGetDataService({
    companyId
  });

  return res.status(200).json(flows);
};
