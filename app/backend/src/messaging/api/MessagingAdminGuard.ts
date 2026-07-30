import { NextFunction, Request, Response } from "express";

import AppError from "../../errors/AppError";

const ADMIN_PROFILES = new Set(["admin", "superadmin"]);

export const requireMessagingAdmin = (req: Request): void => {
  if (!ADMIN_PROFILES.has(req.user?.profile)) {
    throw new AppError(
      "Somente administradores podem gerenciar a mensageria",
      403
    );
  }
};

const isMessagingAdmin = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  requireMessagingAdmin(req);
  next();
};

export default isMessagingAdmin;
