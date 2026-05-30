/**
 * audit.ts — HIPAA audit logging middleware
 * Logs all API requests that access patient data.
 */

import { Request, Response, NextFunction } from "express";
import { auditLog } from "../services/audit-service";
import { AuthenticatedRequest } from "../lib/types";

/**
 * Audit middleware — logs data access. Non-blocking (async fire-and-forget).
 */
export function auditAccess(action: string, resourceType?: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const authReq = req as AuthenticatedRequest;

    auditLog({
      clinicId: authReq.clinic?.id || authReq.user?.clinicId || undefined,
      userId: authReq.user?.id,
      action,
      resourceType,
      resourceId: (req.params.id as string) || undefined,
      details: {
        method: req.method,
        path: req.path,
        query: req.query,
      },
      ipAddress: String(req.ip || req.socket.remoteAddress || ""),
      userAgent: req.headers["user-agent"],
    });

    next();
  };
}
