/**
 * auth.ts — JWT authentication middleware
 */

import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/jwt";
import { queryOne } from "../lib/db";
import { AuthenticatedRequest } from "../lib/types";

/**
 * Require authentication. Optionally restrict to specific roles.
 */
export function requireAuth(roles?: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authReq = req as AuthenticatedRequest;

    // Get token from cookie or Authorization header
    const token =
      req.cookies?.auth_token ||
      req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const payload = verifyToken(token);

      // Load user from DB to check is_active
      const user = await queryOne<any>(
        "SELECT id, email, name, role, clinic_id FROM users WHERE id = $1 AND is_active = true",
        [payload.sub]
      );

      if (!user) {
        res.status(401).json({ error: "User not found or deactivated" });
        return;
      }

      // Check role if specified
      if (roles && !roles.includes(user.role)) {
        res.status(403).json({ error: "Insufficient permissions" });
        return;
      }

      authReq.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        clinicId: user.clinic_id,
      };

      next();
    } catch (err: any) {
      res.status(401).json({ error: "Invalid or expired token" });
    }
  };
}
