/**
 * tenant.ts — Resolve clinic (tenant) from request context
 */

import { Request, Response, NextFunction } from "express";
import { loadClinicConfig } from "../services/clinic-service";
import { AuthenticatedRequest } from "../lib/types";

/**
 * Resolve clinic from authenticated user session (dashboard path).
 * Requires auth middleware to have already set req.user.
 */
export async function resolveClinicFromUser(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authReq = req as AuthenticatedRequest;

  if (!authReq.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  // Superadmins can override clinic via query param
  const clinicId =
    (authReq.user.role === "superadmin" && (req.query.clinic_id as string)) ||
    authReq.user.clinicId;

  if (!clinicId) {
    // Superadmin without clinic context — allow through for admin routes
    next();
    return;
  }

  const clinic = await loadClinicConfig(clinicId);
  if (!clinic) {
    res.status(404).json({ error: "Clinic not found" });
    return;
  }

  authReq.clinic = clinic;
  next();
}
