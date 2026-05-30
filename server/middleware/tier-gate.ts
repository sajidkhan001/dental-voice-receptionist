import { Request, Response, NextFunction } from "express";

/**
 * Self-hosted builds do not gate features by billing tier.
 */
export function requireTierFeature(_feature: string) {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    next();
  };
}
