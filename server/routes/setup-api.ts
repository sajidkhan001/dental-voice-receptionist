/**
 * setup-api.ts — Self-service Go Live + setup status endpoints.
 * Allows clinic admins to activate their AI receptionist from the dashboard.
 * Uses the DIY voice pipeline (Telnyx + Deepgram + Claude + Inworld).
 */

import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import { resolveClinicFromUser } from "../middleware/tenant";
import { auditAccess } from "../middleware/audit";
import { AuthenticatedRequest, ClinicConfig } from "../lib/types";
import { updateClinic } from "../services/clinic-service";
import { getClinicCredentials } from "../services/credentials-service";
import { execute } from "../lib/db";
import logger from "../lib/logger";

/**
 * Provision a Telnyx phone number and activate a clinic.
 * Used by both the Go Live endpoint and the calendar OAuth callback (auto-activation).
 * Returns the provisioned phone number, or throws on failure.
 */
export async function provisionAndActivate(
  clinicId: string,
  clinicName: string,
  clinicSlug: string,
  baseUrl: string,
): Promise<{ phone_number: string; mode: "simulation" | "production" }> {
  const credentials = await getClinicCredentials(clinicId);

  // Simulation mode: no Telnyx credentials
  if (!credentials.telnyxApiKey) {
    const simPhone = `+1555${String(Date.now()).slice(-7)}`;

    await execute(
      `UPDATE clinics SET telnyx_phone_number = $1, sms_from_number = $1, status = 'active', updated_at = NOW() WHERE id = $2`,
      [simPhone, clinicId]
    );

    logger.info(`[GO_LIVE] Clinic ${clinicName} (${clinicSlug}) is now ACTIVE (simulation) — phone: ${simPhone}`);
    return { phone_number: simPhone, mode: "simulation" };
  }

  // Production: buy a real Telnyx number
  const Telnyx = (await import("telnyx")).default;
  const telnyx = new Telnyx({ apiKey: credentials.telnyxApiKey });

  const available = await telnyx.availablePhoneNumbers.list({
    filter: {
      country_code: "US",
      features: ["voice", "sms"],
      limit: 1,
    },
  });

  const numbers = available?.data || [];
  if (!numbers.length) {
    throw new Error("No phone numbers available. Please try again.");
  }

  await telnyx.numberOrders.create({
    phone_numbers: [{ phone_number: (numbers[0] as any).phone_number }],
  });

  const phoneNumber = (numbers[0] as any).phone_number as string;

  await updateClinic(clinicId, {
    telnyxPhoneNumber: phoneNumber,
    smsFromNumber: phoneNumber,
    status: "active",
  });

  logger.info(`[GO_LIVE] Clinic ${clinicName} (${clinicSlug}) is now ACTIVE — phone: ${phoneNumber}`);
  return { phone_number: phoneNumber, mode: "production" };
}

const router = Router();

router.use(requireAuth(["clinic_admin", "superadmin"]));
router.use(resolveClinicFromUser);

// GET /api/setup/status — setup progress checklist
router.get("/status", async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.clinic) {
    res.status(400).json({ error: "No clinic context" });
    return;
  }

  const clinic = authReq.clinic;

  const steps = {
    clinic_created: true,
    has_providers: clinic.providers.length > 0,
    has_services: clinic.services.length > 0,
    calendar_connected: !!clinic.googleAuth,
    voice_configured: !!((clinic.telnyxPhoneNumber || clinic.twilioPhoneNumber) && (await getClinicCredentials(clinic.id)).telnyxApiKey),
    is_active: clinic.status === "active",
  };

  const completedCount = Object.values(steps).filter(Boolean).length;
  const totalCount = Object.keys(steps).length;

  res.json({
    steps,
    progress: Math.round((completedCount / totalCount) * 100),
    clinic_status: clinic.status,
    phone_number: clinic.telnyxPhoneNumber || clinic.twilioPhoneNumber || null,
  });
});

// POST /api/setup/go-live — manual activation fallback (provisions Telnyx phone + activates clinic)
router.post(
  "/go-live",
  auditAccess("setup.go_live"),
  async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.clinic) {
      res.status(400).json({ error: "No clinic context" });
      return;
    }

    const clinic = authReq.clinic;

    // Pre-flight checks
    if (!clinic.googleAuth) {
      res.status(400).json({
        error: "Google Calendar not connected",
        hint: "Connect your Google Calendar from Settings before going live.",
      });
      return;
    }

    if (clinic.providers.length === 0) {
      res.status(400).json({ error: "No providers configured" });
      return;
    }

    if (clinic.services.length === 0) {
      res.status(400).json({ error: "No services configured" });
      return;
    }

    // If already active with a phone number, return existing info
    const existingPhone = clinic.telnyxPhoneNumber || clinic.twilioPhoneNumber;
    if (clinic.status === "active" && existingPhone) {
      res.json({
        success: true,
        already_active: true,
        phone_number: existingPhone,
      });
      return;
    }

    try {
      const proto = req.headers["x-forwarded-proto"] || "http";
      const baseUrl = `${proto}://${req.headers.host}`;
      const result = await provisionAndActivate(clinic.id, clinic.name, clinic.slug, baseUrl);

      res.json({
        success: true,
        phone_number: result.phone_number,
        mode: result.mode,
      });
    } catch (err: any) {
      logger.error(`[GO_LIVE] Failed for clinic ${clinic.slug}:`, err.message);
      res.status(500).json({ error: err.message || "Voice provisioning failed" });
    }
  }
);

export default router;
