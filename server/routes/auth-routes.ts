/**
 * auth-routes.ts — Authentication endpoints
 */

import { Router, Request, Response } from "express";
import bcrypt from "bcrypt";
import { queryOne, execute } from "../lib/db";
import { signToken } from "../lib/jwt";
import { requireAuth } from "../middleware/auth";
import { auditLog } from "../services/audit-service";
import { AuthenticatedRequest } from "../lib/types";
import { validate } from "../middleware/validate";
import { loginSchema } from "../lib/validators";

const router = Router();

// POST /api/auth/login
router.post("/login", validate(loginSchema), async (req: Request, res: Response) => {
  const { email, password } = req.body;

  const user = await queryOne<any>(
    "SELECT id, email, name, role, clinic_id, password_hash FROM users WHERE email = $1 AND is_active = true",
    [email]
  );

  if (!user) {
    auditLog({
      action: "auth.login_failed",
      details: { email, reason: "user_not_found" },
      ipAddress: req.ip || req.socket.remoteAddress,
    });
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    auditLog({
      userId: user.id,
      clinicId: user.clinic_id,
      action: "auth.login_failed",
      details: { reason: "invalid_password" },
      ipAddress: req.ip || req.socket.remoteAddress,
    });
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  // Update last login
  await execute("UPDATE users SET last_login_at = NOW() WHERE id = $1", [user.id]);

  const token = signToken({
    sub: user.id,
    clinicId: user.clinic_id,
    role: user.role,
  });

  auditLog({
    userId: user.id,
    clinicId: user.clinic_id,
    action: "auth.login",
    ipAddress: req.ip || req.socket.remoteAddress,
  });

  // Set HttpOnly cookie
  res.cookie("auth_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000, // 24h
  });

  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      clinicId: user.clinic_id,
    },
    token, // Also return token for API clients
  });
});

// POST /api/auth/logout
router.post("/logout", (req: Request, res: Response) => {
  res.clearCookie("auth_token");
  res.json({ status: "logged_out" });
});

// GET /api/auth/me
router.get("/me", requireAuth(), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const user = authReq.user!;

  let clinicName: string | null = null;
  if (user.clinicId) {
    const clinic = await queryOne<{ name: string }>(
      "SELECT name FROM clinics WHERE id = $1",
      [user.clinicId]
    );
    clinicName = clinic?.name || null;
  }

  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    clinicId: user.clinicId,
    clinicName,
  });
});

// PUT /api/auth/change-password
router.put("/change-password", requireAuth(), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    res.status(400).json({ error: "Both current_password and new_password are required" });
    return;
  }

  if (new_password.length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters" });
    return;
  }

  const user = await queryOne<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE id = $1 AND is_active = true",
    [authReq.user!.id]
  );

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const valid = await bcrypt.compare(current_password, user.password_hash);
  if (!valid) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  const hash = await bcrypt.hash(new_password, 12);
  await execute("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2", [hash, authReq.user!.id]);

  auditLog({
    userId: authReq.user!.id,
    clinicId: authReq.user!.clinicId || undefined,
    action: "auth.password_changed",
    ipAddress: req.ip || req.socket.remoteAddress,
  });

  res.json({ success: true });
});

// PUT /api/auth/profile
router.put("/profile", requireAuth(), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const { name, email } = req.body;

  const updates: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (name !== undefined) {
    updates.push(`name = $${idx++}`);
    values.push(name);
  }
  if (email !== undefined) {
    updates.push(`email = $${idx++}`);
    values.push(email.toLowerCase().trim());
  }

  if (updates.length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  updates.push(`updated_at = NOW()`);
  values.push(authReq.user!.id);

  await execute(
    `UPDATE users SET ${updates.join(", ")} WHERE id = $${idx}`,
    values
  );

  auditLog({
    userId: authReq.user!.id,
    clinicId: authReq.user!.clinicId || undefined,
    action: "auth.profile_updated",
    details: { name, email },
    ipAddress: req.ip || req.socket.remoteAddress,
  });

  res.json({ success: true });
});

export default router;
