/**
 * dashboard-api.ts — Clinic-scoped dashboard API routes
 * All routes require authentication and are scoped to the user's clinic.
 */

import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import { resolveClinicFromUser } from "../middleware/tenant";
import { auditAccess } from "../middleware/audit";
import { requireTierFeature } from "../middleware/tier-gate";
import { AuthenticatedRequest } from "../lib/types";
import { getCallLogs, getKpis, getAnalytics } from "../services/call-service";
import { getBookings, getMonthlyAppointments, getTodaysAppointments, getNoShowStats, updateBookingStatus } from "../services/booking-service";
import { triggerFollowup, getFollowups } from "../services/noshow-service";
import { findRecallCandidates, sendRecallSms, triggerRecallCall, getRecallHistory } from "../services/recall-service";
import { getReviewStats } from "../services/review-service";
import { getIntakeForms, getIntakeFormById, reviewIntakeForm, getIntakeStats } from "../services/intake-service";
import { healthCheck as dbHealthCheck } from "../lib/db";
import { execute } from "../lib/db";
import { auditLog } from "../services/audit-service";
import { getCredentialStatus, saveClinicCredentials } from "../services/credentials-service";
import type { CredentialField } from "../services/credentials-service";

const router = Router();

// All dashboard routes require auth + clinic resolution
router.use(requireAuth(["clinic_admin", "clinic_staff", "superadmin"]));
router.use(resolveClinicFromUser);

// GET /api/dashboard/kpis
router.get("/kpis", auditAccess("dashboard.view_kpis"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.clinic) {
    res.status(400).json({ error: "No clinic context" });
    return;
  }

  const kpis = await getKpis(authReq.clinic.id);
  res.json(kpis);
});

// GET /api/dashboard/calls
router.get("/calls", auditAccess("dashboard.view_calls", "call_log"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.clinic) {
    res.status(400).json({ error: "No clinic context" });
    return;
  }

  const { rows, total } = await getCallLogs(authReq.clinic.id, {
    limit: parseInt(req.query.limit as string) || 50,
    offset: parseInt(req.query.offset as string) || 0,
    intent: req.query.intent as string,
    dateFrom: req.query.date_from as string,
    dateTo: req.query.date_to as string,
  });

  res.json({ calls: rows, total, limit: 50, offset: parseInt(req.query.offset as string) || 0 });
});

// GET /api/dashboard/appointments
router.get("/appointments", auditAccess("dashboard.view_appointments", "booking"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.clinic) {
    res.status(400).json({ error: "No clinic context" });
    return;
  }

  const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
  const appointments = await getMonthlyAppointments(authReq.clinic.id, month);
  res.json({ appointments, month });
});

// GET /api/dashboard/analytics
router.get("/analytics", requireTierFeature("full_dashboard"), auditAccess("dashboard.view_analytics"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.clinic) {
    res.status(400).json({ error: "No clinic context" });
    return;
  }

  const days = parseInt(req.query.days as string) || 30;
  const analytics = await getAnalytics(authReq.clinic.id, days);
  res.json(analytics);
});

// GET /api/dashboard/appointments/today — Today's appointments with no-show stats
router.get("/appointments/today", auditAccess("dashboard.view_appointments"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.clinic) {
    res.status(400).json({ error: "No clinic context" });
    return;
  }

  try {
    const [appointments, stats] = await Promise.all([
      getTodaysAppointments(authReq.clinic.id),
      getNoShowStats(authReq.clinic.id),
    ]);

    res.json({ appointments, stats });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/dashboard/appointments/:id/status — Update appointment status (arrived/no-show)
router.patch("/appointments/:id/status", async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.clinic) {
    res.status(400).json({ error: "No clinic context" });
    return;
  }

  const { status } = req.body;
  const validStatuses = ["confirmed", "completed", "no_show", "cancelled"];
  if (!status || !validStatuses.includes(status)) {
    res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
    return;
  }

  const bookingId = req.params.id as string;
  try {
    await updateBookingStatus(authReq.clinic.id, bookingId, status);

    await auditLog({
      clinicId: authReq.clinic.id,
      userId: authReq.user?.id,
      action: "booking.update_status",
      resourceType: "booking",
      resourceId: bookingId,
      details: { new_status: status },
    });

    res.json({ success: true, status });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dashboard/appointments/:id/followup — Trigger SMS or AI callback for a no-show
router.post("/appointments/:id/followup", requireTierFeature("followup"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.clinic) {
    res.status(400).json({ error: "No clinic context" });
    return;
  }

  const { type } = req.body;
  if (!type || !["sms", "ai_call"].includes(type)) {
    res.status(400).json({ error: "type must be 'sms' or 'ai_call'" });
    return;
  }

  try {
    const result = await triggerFollowup(
      authReq.clinic.id,
      req.params.id as string,
      type,
      authReq.user?.id || "unknown"
    );

    res.status(result.success ? 200 : 400).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/appointments/:id/followups — Follow-up history for a booking
router.get("/appointments/:id/followups", requireTierFeature("followup"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.clinic) {
    res.status(400).json({ error: "No clinic context" });
    return;
  }

  try {
    const followups = await getFollowups(authReq.clinic.id, req.params.id as string);
    res.json({ followups });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/recall/candidates — Patients eligible for recall
router.get("/recall/candidates", requireTierFeature("recall"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.clinic) {
    res.status(400).json({ error: "No clinic context" });
    return;
  }

  try {
    const candidates = await findRecallCandidates(authReq.clinic.id);
    res.json({ candidates, total: candidates.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dashboard/recall/trigger — Trigger recall for a specific patient
router.post("/recall/trigger", requireTierFeature("recall"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.clinic) {
    res.status(400).json({ error: "No clinic context" });
    return;
  }

  const { patient_name, patient_phone, patient_email, last_visit_date, last_service, type } = req.body;
  if (!patient_name || !patient_phone) {
    res.status(400).json({ error: "patient_name and patient_phone are required" });
    return;
  }

  const candidate = {
    patient_name,
    patient_phone,
    patient_email: patient_email || null,
    last_visit_date: last_visit_date || null,
    last_service: last_service || null,
    clinic_id: authReq.clinic.id,
    clinic_name: authReq.clinic.name,
    clinic_phone: authReq.clinic.phone,
  };

  try {
    let result;
    if (type === "ai_call") {
      result = await triggerRecallCall(authReq.clinic.id, candidate, authReq.user?.id || "unknown");
    } else {
      result = await sendRecallSms(authReq.clinic.id, candidate);
    }
    res.status(result.success ? 200 : 400).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/recall/history — Recall campaign history
router.get("/recall/history", requireTierFeature("recall"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.clinic) {
    res.status(400).json({ error: "No clinic context" });
    return;
  }

  try {
    const { rows, total } = await getRecallHistory(
      authReq.clinic.id,
      parseInt(req.query.limit as string) || 50,
      parseInt(req.query.offset as string) || 0
    );
    res.json({ campaigns: rows, total });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/reviews — Review request stats and history
router.get("/reviews", requireTierFeature("followup"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.clinic) {
    res.status(400).json({ error: "No clinic context" });
    return;
  }

  try {
    const stats = await getReviewStats(
      authReq.clinic.id,
      parseInt(req.query.limit as string) || 50,
      parseInt(req.query.offset as string) || 0
    );
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Intake Forms ----

// GET /api/dashboard/intake-forms
router.get("/intake-forms", requireTierFeature("intake_forms"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.clinic) { res.status(400).json({ error: "No clinic context" }); return; }

  try {
    const result = await getIntakeForms(authReq.clinic.id, {
      status: req.query.status as string,
      limit: parseInt(req.query.limit as string) || 50,
      offset: parseInt(req.query.offset as string) || 0,
      dateFrom: req.query.date_from as string,
      dateTo: req.query.date_to as string,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/intake-forms/:id
router.get("/intake-forms/:id", requireTierFeature("intake_forms"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.clinic) { res.status(400).json({ error: "No clinic context" }); return; }

  try {
    const form = await getIntakeFormById(authReq.clinic.id, req.params.id as string);
    if (!form) { res.status(404).json({ error: "Form not found" }); return; }
    res.json(form);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dashboard/intake-forms/:id/review
router.post("/intake-forms/:id/review", requireTierFeature("intake_forms"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.clinic) { res.status(400).json({ error: "No clinic context" }); return; }

  try {
    await reviewIntakeForm(authReq.clinic.id, req.params.id as string, authReq.user?.id || "unknown");
    await auditLog({
      clinicId: authReq.clinic.id,
      userId: authReq.user?.id,
      action: "intake.form_reviewed",
      resourceType: "patient_intake_form",
      resourceId: req.params.id as string,
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/intake-forms/stats
router.get("/intake-stats", requireTierFeature("intake_forms"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.clinic) { res.status(400).json({ error: "No clinic context" }); return; }

  try {
    const stats = await getIntakeStats(authReq.clinic.id);
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Insurance Verification ----

// PATCH /api/dashboard/appointments/:id/insurance
router.patch("/appointments/:id/insurance", async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.clinic) { res.status(400).json({ error: "No clinic context" }); return; }

  const { verified, details } = req.body;

  try {
    await execute(
      `UPDATE bookings SET
        insurance_verified = $1,
        insurance_verified_at = CASE WHEN $1 THEN NOW() ELSE NULL END,
        insurance_verified_by = $2,
        insurance_details = COALESCE($3::jsonb, insurance_details),
        updated_at = NOW()
       WHERE id = $4 AND clinic_id = $5`,
      [
        verified ?? false,
        authReq.user?.id || "unknown",
        details ? JSON.stringify(details) : null,
        req.params.id as string,
        authReq.clinic.id,
      ]
    );

    await auditLog({
      clinicId: authReq.clinic.id,
      userId: authReq.user?.id,
      action: verified ? "insurance.verified" : "insurance.unverified",
      resourceType: "booking",
      resourceId: req.params.id as string,
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Credentials (API Keys) ----

// GET /api/dashboard/credentials — returns configured/not-configured + last 4 chars; never raw keys
router.get("/credentials", async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.clinic) { res.status(400).json({ error: "No clinic context" }); return; }
  try {
    const status = await getCredentialStatus(authReq.clinic.id);
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dashboard/credentials — encrypt and persist one or more fields
router.post("/credentials", async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.clinic) { res.status(400).json({ error: "No clinic context" }); return; }

  const allowed: CredentialField[] = [
    "anthropicApiKey", "deepgramApiKey", "inworldApiKey", "inworldVoiceId", "inworldModelId",
    "telnyxApiKey", "telnyxConnectionId", "telnyxFromNumber", "telnyxWebhookSecret",
    "sendgridApiKey", "gmailUser", "gmailAppPassword", "googleClientId", "googleClientSecret",
  ];

  const values: Partial<Record<CredentialField, string | null>> = {};
  for (const field of allowed) {
    if (field in req.body) {
      const v = req.body[field];
      values[field] = typeof v === "string" ? v : null;
    }
  }

  if (Object.keys(values).length === 0) {
    res.status(400).json({ error: "No valid credential fields provided" });
    return;
  }

  try {
    await saveClinicCredentials(authReq.clinic.id, values);
    await auditLog({
      clinicId: authReq.clinic.id,
      userId: authReq.user?.id,
      action: "credentials.updated",
      resourceType: "clinic",
      resourceId: authReq.clinic.id,
    });
    res.json({ saved: Object.keys(values).length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/status
router.get("/status", async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.clinic) {
    res.status(400).json({ error: "No clinic context" });
    return;
  }

  const clinic = authReq.clinic;
  const dbOk = await dbHealthCheck();

  res.json({
    clinic: {
      name: clinic.name,
      slug: clinic.slug,
      status: clinic.status,
      phone: clinic.phone,
    },
    integrations: {
      voice: (clinic.telnyxPhoneNumber || clinic.twilioPhoneNumber) ? "configured" : "not_configured",
      google_calendar: clinic.googleAuth ? "configured" : "not_configured",
      sms: clinic.smsFromNumber ? "configured" : "not_configured",
      email: clinic.emailFrom ? "configured" : "not_configured",
    },
    system: {
      database: dbOk,
      uptime: process.uptime(),
      simulation_mode: process.env.SIMULATION_MODE !== "false",
    },
  });
});

export default router;
