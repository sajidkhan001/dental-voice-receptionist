/**
 * audit-service.ts — HIPAA-compliant append-only audit logging
 * Never UPDATE or DELETE from audit_logs.
 */

import { execute, query, queryOne } from "../lib/db";
import logger from "../lib/logger";

export async function auditLog(params: {
  clinicId?: string;
  userId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> {
  try {
    await execute(
      `INSERT INTO audit_logs (clinic_id, user_id, action, resource_type, resource_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        params.clinicId || null,
        params.userId || null,
        params.action,
        params.resourceType || null,
        params.resourceId || null,
        params.details ? JSON.stringify(params.details) : null,
        params.ipAddress || null,
        params.userAgent || null,
      ]
    );
  } catch (err: any) {
    logger.error("[AUDIT] Failed to write audit log:", err.message);
  }
}

export async function getAuditLogs(options: {
  clinicId?: string;
  userId?: string;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ rows: any[]; total: number }> {
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (options.clinicId) {
    conditions.push(`a.clinic_id = $${idx++}`);
    params.push(options.clinicId);
  }
  if (options.userId) {
    conditions.push(`a.user_id = $${idx++}`);
    params.push(options.userId);
  }
  if (options.action) {
    conditions.push(`a.action = $${idx++}`);
    params.push(options.action);
  }
  if (options.dateFrom) {
    conditions.push(`a.created_at >= $${idx++}`);
    params.push(options.dateFrom);
  }
  if (options.dateTo) {
    conditions.push(`a.created_at <= $${idx++}`);
    params.push(options.dateTo);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const [rows, countResult] = await Promise.all([
    query(
      `SELECT a.*, u.email as user_email, c.name as clinic_name
       FROM audit_logs a
       LEFT JOIN users u ON a.user_id = u.id
       LEFT JOIN clinics c ON a.clinic_id = c.id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, options.limit || 100, options.offset || 0]
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM audit_logs a ${where}`,
      params
    ),
  ]);

  return { rows, total: parseInt(countResult?.count || "0", 10) };
}
