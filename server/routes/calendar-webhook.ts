/**
 * calendar-webhook.ts — Google Calendar push notification webhook
 *
 * Receives change notifications from Google Calendar when events are
 * created, updated, or deleted externally (e.g., via PMS → Google Calendar sync).
 */

import { Router, Request, Response } from "express";
import { handleCalendarChange, getSyncStatus, watchCalendar } from "../services/calendar-sync-service";
import { requireAuth } from "../middleware/auth";
import { resolveClinicFromUser } from "../middleware/tenant";
import { auditAccess } from "../middleware/audit";
import { AuthenticatedRequest } from "../lib/types";
import { queryOne } from "../lib/db";
import logger from "../lib/logger";

const router = Router();

/**
 * POST /webhook/google-calendar
 * Google Calendar push notification endpoint (no auth — Google sends these).
 * Google includes X-Goog-Channel-ID and X-Goog-Resource-ID headers.
 */
router.post("/", async (req: Request, res: Response) => {
  const channelId = req.headers["x-goog-channel-id"] as string;
  const resourceState = req.headers["x-goog-resource-state"] as string;

  if (!channelId) {
    res.sendStatus(400);
    return;
  }

  // Acknowledge immediately (Google expects 200 within 10s)
  res.sendStatus(200);

  // "sync" is the initial verification — no actual change
  if (resourceState === "sync") {
    logger.info(`[CALENDAR-WEBHOOK] Sync verification for channel ${channelId}`);
    return;
  }

  // Look up which clinic this watch belongs to
  try {
    const clinic = await queryOne<{ id: string }>(
      `SELECT id FROM clinics WHERE google_calendar_watch_id = $1`,
      [channelId]
    );

    if (!clinic) {
      logger.warn(`[CALENDAR-WEBHOOK] No clinic found for channel ${channelId}`);
      return;
    }

    const result = await handleCalendarChange(clinic.id);
    logger.info(`[CALENDAR-WEBHOOK] Processed: ${result.synced} synced, ${result.conflicts} conflicts`);
  } catch (err: any) {
    logger.error(`[CALENDAR-WEBHOOK] Error processing change:`, err.message);
  }
});

// ---- Authenticated routes for dashboard ----

const authRouter = Router();
authRouter.use(requireAuth(["clinic_admin", "superadmin"]));
authRouter.use(resolveClinicFromUser);

/**
 * GET /api/dashboard/calendar-sync/status
 * Get calendar sync status for the current clinic
 */
authRouter.get("/status", auditAccess("calendar_sync.view_status"), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.clinic) {
    res.status(400).json({ error: "No clinic context" });
    return;
  }

  try {
    const status = await getSyncStatus(authReq.clinic.id);
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/dashboard/calendar-sync/enable
 * Enable bidirectional sync by registering a watch channel
 */
authRouter.post("/enable", async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.clinic) {
    res.status(400).json({ error: "No clinic context" });
    return;
  }

  try {
    const proto = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.get("host");
    const webhookUrl = `${proto}://${host}/webhook/google-calendar`;

    const result = await watchCalendar(authReq.clinic.id, webhookUrl);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/dashboard/calendar-sync/resync
 * Manually trigger a sync
 */
authRouter.post("/resync", async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.clinic) {
    res.status(400).json({ error: "No clinic context" });
    return;
  }

  try {
    const result = await handleCalendarChange(authReq.clinic.id);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export { router as calendarWebhookRouter, authRouter as calendarSyncApiRouter };
