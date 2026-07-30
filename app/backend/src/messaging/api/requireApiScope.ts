import { NextFunction, Request, Response } from "express";
import AppError from "../../errors/AppError";

const requireApiScope = (scope: string) => (
  req: Request,
  _: Response,
  next: NextFunction
): void => {
  if (!req.apiCredential?.scopes.includes(scope)) {
    throw new AppError("Escopo de API insuficiente", 403);
  }

  next();
};

export default requireApiScope;
