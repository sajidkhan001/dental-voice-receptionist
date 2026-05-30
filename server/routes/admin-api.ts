/**
 * admin-api.ts — Superadmin API routes
 */

import { Router, Request, Response } from "express";
import bcrypt from "bcrypt";
import { requireAuth } from "../middleware/auth";
import { auditAccess } from "../middleware/audit";
import { listClinics, loadClinicConfig, updateClinic, createClinic, createProvider, createService } from "../services/clinic-service";
import { getCallLogs, getKpis } from "../services/call-service";
import { getAuditLogs } from "../services/audit-service";
import { query, queryOne, execute } from "../lib/db";
import { validate } from "../middleware/validate";
import { createClinicSchema, createUserSchema, createProviderSchema, createServiceSchema } from "../lib/validators";

const router = Router();

// All admin routes require superadmin
router.use(requireAuth(["superadmin"]));

// GET /api/admin/clinics
router.get("/clinics", auditAccess("admin.list_clinics"), async (_req: Request, res: Response) => {
  const clinics = await listClinics();

  // Enrich with call counts
  const enriched = await Promise.all(
    clinics.map(async (c) => {
      const kpis = await getKpis(c.id);
      return { ...c, ...kpis };
    })
  );

  res.json({ clinics: enriched });
});

// GET /api/admin/clinics/:id
router.get("/clinics/:id", auditAccess("admin.view_clinic", "clinic"), async (req: Request, res: Response) => {
  const clinic = await loadClinicConfig(req.params.id as string);
  if (!clinic) {
    res.status(404).json({ error: "Clinic not found" });
    return;
  }
  // Strip sensitive fields
  const { googleAuth, ...safe } = clinic;
  res.json({ clinic: { ...safe, hasGoogleAuth: !!googleAuth } });
});

// POST /api/admin/clinics
router.post("/clinics", validate(createClinicSchema), auditAccess("admin.create_clinic", "clinic"), async (req: Request, res: Response) => {
  try {
    const id = await createClinic(req.body);
    res.status(201).json({ id, status: "created" });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/admin/clinics/:id
router.put("/clinics/:id", auditAccess("admin.update_clinic", "clinic"), async (req: Request, res: Response) => {
  try {
    await updateClinic(req.params.id as string, req.body);
    res.json({ status: "updated" });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/admin/clinics/:id/providers
router.post("/clinics/:id/providers", validate(createProviderSchema), auditAccess("admin.create_provider", "provider"), async (req: Request, res: Response) => {
  try {
    const providerId = await createProvider(req.params.id as string, req.body);
    res.status(201).json({ id: providerId });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/admin/clinics/:id/services
router.post("/clinics/:id/services", validate(createServiceSchema), auditAccess("admin.create_service", "service"), async (req: Request, res: Response) => {
  try {
    const serviceId = await createService(req.params.id as string, req.body);
    res.status(201).json({ id: serviceId });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/admin/clinics/:id/calls
router.get("/clinics/:id/calls", auditAccess("admin.view_clinic_calls", "call_log"), async (req: Request, res: Response) => {
  const { rows, total } = await getCallLogs(req.params.id as string, {
    limit: parseInt(req.query.limit as string) || 50,
    offset: parseInt(req.query.offset as string) || 0,
  });
  res.json({ calls: rows, total });
});

// POST /api/admin/users
router.post("/users", validate(createUserSchema), auditAccess("admin.create_user", "user"), async (req: Request, res: Response) => {
  const { email, password, name, role, clinicId } = req.body;

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await queryOne<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, role, clinic_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [email.toLowerCase().trim(), passwordHash, name || null, role, clinicId || null]
    );
    res.status(201).json({ id: user!.id });
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(409).json({ error: "Email already exists" });
    } else {
      res.status(400).json({ error: err.message });
    }
  }
});

// GET /api/admin/users
router.get("/users", auditAccess("admin.list_users"), async (_req: Request, res: Response) => {
  const users = await query(
    `SELECT u.id, u.email, u.name, u.role, u.clinic_id, u.is_active, u.last_login_at, u.created_at,
            c.name as clinic_name
     FROM users u
     LEFT JOIN clinics c ON u.clinic_id = c.id
     ORDER BY u.created_at DESC`
  );
  res.json({ users });
});

// GET /api/admin/audit-logs
router.get("/audit-logs", auditAccess("admin.view_audit_logs"), async (req: Request, res: Response) => {
  const { rows, total } = await getAuditLogs({
    clinicId: req.query.clinic_id as string,
    action: req.query.action as string,
    dateFrom: req.query.date_from as string,
    dateTo: req.query.date_to as string,
    limit: parseInt(req.query.limit as string) || 100,
    offset: parseInt(req.query.offset as string) || 0,
  });
  res.json({ logs: rows, total });
});


// GET /api/admin/overview
router.get("/overview", auditAccess("admin.view_overview"), async (_req: Request, res: Response) => {
  const stats = await queryOne<any>(`
    SELECT
      (SELECT COUNT(*) FROM clinics) as total_clinics,
      (SELECT COUNT(*) FROM clinics WHERE status = 'active') as active_clinics,
      (SELECT COUNT(*) FROM call_logs) as total_calls,
      (SELECT COUNT(*) FROM call_logs WHERE created_at::date = CURRENT_DATE) as today_calls,
      (SELECT COUNT(*) FROM bookings WHERE status = 'confirmed') as total_bookings,
      (SELECT COUNT(*) FROM users WHERE is_active = true) as total_users
  `);
  res.json(stats);
});

export default router;
