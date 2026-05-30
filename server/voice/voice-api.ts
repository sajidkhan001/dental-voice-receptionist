/**
 * voice-api.ts — Voice provisioning and configuration endpoints
 *
 * Uses Telnyx for phone number management and voice pipeline.
 */

import { Router, Request, Response } from "express";
import { AuthenticatedRequest } from "../lib/types";
import { requireAuth } from "../middleware/auth";
import { resolveClinicFromUser } from "../middleware/tenant";
import { execute, queryOne } from "../lib/db";
import { auditLog } from "../services/audit-service";
import { getClinicCredentials } from "../services/credentials-service";
import logger from "../lib/logger";

const router = Router();

router.use(requireAuth(), resolveClinicFromUser);

/**
 * POST /api/voice/provision-phone — Buy a Telnyx phone number for the clinic
 */
router.post("/provision-phone", async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const clinic = authReq.clinic;

  if (!clinic) {
    res.status(400).json({ error: "No clinic context" });
    return;
  }

  // Check if already has a phone number
  if (clinic.telnyxPhoneNumber) {
    res.json({
      phone_number: clinic.telnyxPhoneNumber,
      message: "Phone number already provisioned",
    });
    return;
  }

  const credentials = await getClinicCredentials(clinic.id);

  if (!credentials.telnyxApiKey) {
    // Simulation mode
    const simPhone = `+1555${String(Date.now()).slice(-7)}`;
    await execute(
      `UPDATE clinics SET telnyx_phone_number = $1, updated_at = NOW() WHERE id = $2`,
      [simPhone, clinic.id]
    );

    await auditLog({
      clinicId: clinic.id,
      userId: authReq.user!.id,
      action: "voice.provision_phone",
      details: { phone_number: simPhone, mode: "simulation" },
    });

    logger.info(`[VOICE] Simulated phone provisioning for ${clinic.name}: ${simPhone}`);
    res.json({ phone_number: simPhone, mode: "simulation" });
    return;
  }

  try {
    const Telnyx = (await import("telnyx")).default;
    const telnyx = new Telnyx({ apiKey: credentials.telnyxApiKey });

    // Search for available US phone numbers
    const available = await telnyx.availablePhoneNumbers.list({
      filter: {
        country_code: "US",
        features: ["voice", "sms"],
        limit: 1,
      },
    });

    const numbers = available?.data || [];
    if (!numbers.length) {
      res.status(500).json({ error: "No phone numbers available in your area" });
      return;
    }

    // Purchase the number
    const firstNumber = (numbers[0] as any).phone_number as string;
    await telnyx.numberOrders.create({
      phone_numbers: [{ phone_number: firstNumber }],
    });

    const phoneNumber = firstNumber;

    // Configure the number with webhooks
    // Telnyx uses "messaging profiles" and "connection" for webhook setup
    // The webhook URLs are configured at the connection level in Telnyx portal
    // or via API after purchase

    // Save to DB
    await execute(
      `UPDATE clinics SET telnyx_phone_number = $1, updated_at = NOW() WHERE id = $2`,
      [phoneNumber, clinic.id]
    );

    await auditLog({
      clinicId: clinic.id,
      userId: authReq.user!.id,
      action: "voice.provision_phone",
      details: { phone_number: phoneNumber, provider: "telnyx" },
    });

    logger.info(`[VOICE] Provisioned phone for ${clinic.name}: ${phoneNumber}`);
    res.json({
      phone_number: phoneNumber,
      provider: "telnyx",
    });
  } catch (err: any) {
    logger.error("[VOICE] Phone provisioning failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/voice/config — Update voice configuration
 */
router.post("/config", async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const clinic = authReq.clinic;

  if (!clinic) {
    res.status(400).json({ error: "No clinic context" });
    return;
  }

  const { voice_id, greeting, language } = req.body;

  const config = {
    ...clinic.voiceConfig,
    ...(voice_id && { voiceId: voice_id }),
    ...(greeting && { greeting }),
    ...(language && { language }),
  };

  await execute(
    `UPDATE clinics SET voice_config = $1, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(config), clinic.id]
  );

  await auditLog({
    clinicId: clinic.id,
    userId: authReq.user!.id,
    action: "voice.update_config",
    details: config,
  });

  res.json({ success: true, config });
});

/**
 * GET /api/voice/status — Voice pipeline status
 */
router.get("/status", async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const clinic = authReq.clinic;

  if (!clinic) {
    res.status(400).json({ error: "No clinic context" });
    return;
  }

  const { callManager } = await import("./call-manager");

  const latencyStats = callManager.getLatencyStats();
  const credentials = await getClinicCredentials(clinic.id);

  res.json({
    phone_number: clinic.telnyxPhoneNumber,
    has_phone: !!clinic.telnyxPhoneNumber,
    active_calls: latencyStats.activeCalls,
    voice_config: clinic.voiceConfig,
    latency: {
      avg_turn_ms: latencyStats.avgTurnMs,
      p95_turn_ms: latencyStats.p95TurnMs,
    },
    providers: {
      stt: credentials.deepgramApiKey ? "deepgram" : "simulation",
      llm: credentials.anthropicApiKey ? "claude" : "simulation",
      tts: credentials.inworldApiKey ? "inworld" : "simulation",
      telephony: credentials.telnyxApiKey ? "telnyx" : "simulation",
    },
  });
});

function getBaseUrl(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] || "http";
  return `${proto}://${req.headers.host}`;
}

export default router;
