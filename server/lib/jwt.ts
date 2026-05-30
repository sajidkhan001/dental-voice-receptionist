/**
 * jwt.ts — JWT sign/verify for session management
 */

import jwt from "jsonwebtoken";

export interface JwtPayload {
  sub: string;        // user ID
  clinicId: string | null;
  role: string;
  iat?: number;
  exp?: number;
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET env var is required");
  }
  return secret;
}

export function signToken(payload: Omit<JwtPayload, "iat" | "exp">): string {
  return jwt.sign(payload, getSecret(), { expiresIn: "24h" });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, getSecret()) as JwtPayload;
}
