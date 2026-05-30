/**
 * calendar-oauth.ts — Google Calendar OAuth flow for self-service setup.
 * Clinics connect their own Google Calendar via OAuth from the dashboard.
 */

import { Router, Request, Response } from "express";
import { google } from "googleapis";
import crypto from "crypto";
import { requireAuth } from "../middleware/auth";
import { resolveClinicFromUser } from "../middleware/tenant";
import { AuthenticatedRequest } from "../lib/types";
import { updateClinicGoogleAuth, loadClinicConfig } from "../services/clinic-service";
import { getClinicCredentials } from "../services/credentials-service";
import { auditAccess } from "../middleware/audit";
import { provisionAndActivate } from "./setup-api";
import logger from "../lib/logger";

const router = Router();

router.use(requireAuth(["clinic_admin", "superadmin"]));
router.use(resolveClinicFromUser);

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

async function getOAuth2Client(clinicId: string, redirectUri: string) {
  const credentials = await getClinicCredentials(clinicId);
  const clientId = credentials.googleClientId;
  const clientSecret = credentials.googleClientSecret;

  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth not configured on the server");
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function getRedirectUri(req: Request): string {
  if (process.env.GOOGLE_OAUTH_REDIRECT_URI) {
    return process.env.GOOGLE_OAUTH_REDIRECT_URI;
  }
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}/api/setup/google-calendar/callback`;
}

// GET /api/setup/google-calendar/auth-url
// Returns the Google OAuth consent URL for the clinic admin to visit.
router.get(
  "/auth-url",
  auditAccess("setup.calendar_auth_start"),
  async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.clinic) {
      res.status(400).json({ error: "No clinic context" });
      return;
    }

    try {
      const redirectUri = getRedirectUri(req);
      const oauth2 = await getOAuth2Client(authReq.clinic.id, redirectUri);

      const authUrl = oauth2.generateAuthUrl({
        access_type: "offline",
        scope: SCOPES,
        prompt: "consent",
        state: `${authReq.clinic.id}.${crypto.createHmac("sha256", process.env.JWT_SECRET!).update(authReq.clinic.id).digest("hex").slice(0, 16)}`,
      });

      res.json({ auth_url: authUrl });
    } catch (err: any) {
      logger.error("[CALENDAR_OAUTH] Failed to generate auth URL:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api/setup/google-calendar/callback
// Google redirects here after consent. Exchanges code for tokens and saves them.
router.get("/callback", async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const { code, error, state } = req.query;

  if (error) {
    logger.error("[CALENDAR_OAUTH] Auth denied:", error);
    res.redirect("/dashboard/settings?calendar=error&reason=" + encodeURIComponent(String(error)));
    return;
  }

  if (!code || typeof code !== "string") {
    res.redirect("/dashboard/settings?calendar=error&reason=no_code");
    return;
  }

  // state = clinicId.hmac from the auth-url step
  const stateStr = state as string;
  const clinicId = stateStr?.split(".")[0] || authReq.clinic?.id;
  if (!clinicId || !stateStr) {
    res.redirect("/dashboard/settings?calendar=error&reason=no_clinic");
    return;
  }

  // Verify HMAC signature
  const expectedSig = crypto.createHmac("sha256", process.env.JWT_SECRET!).update(clinicId).digest("hex").slice(0, 16);
  const providedSig = stateStr.split(".")[1];
  if (!providedSig || !crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(providedSig))) {
    res.redirect("/dashboard/settings?calendar=error&reason=invalid_state");
    return;
  }

  try {
    const redirectUri = getRedirectUri(req);
    const oauth2 = await getOAuth2Client(clinicId, redirectUri);
    const { tokens } = await oauth2.getToken(code);

    const credentials = await getClinicCredentials(clinicId);

    if (!tokens.refresh_token) {
      logger.error("[CALENDAR_OAUTH] No refresh token — user may need to revoke and re-auth");
      res.redirect("/dashboard/settings?calendar=error&reason=no_refresh_token");
      return;
    }

    // Save encrypted tokens to clinic record
    await updateClinicGoogleAuth(clinicId, {
      clientId: credentials.googleClientId!,
      clientSecret: credentials.googleClientSecret!,
      refreshToken: tokens.refresh_token,
      calendarId: "primary",
    });

    logger.info(`[CALENDAR_OAUTH] Calendar connected for clinic ${clinicId}`);

    // Auto-activate: provision phone number if clinic isn't already active
    let phoneNumber: string | null = null;
    try {
      const clinic = await loadClinicConfig(clinicId);
      if (clinic && clinic.status !== "active" && !(clinic.telnyxPhoneNumber || clinic.twilioPhoneNumber)) {
        const proto = req.headers["x-forwarded-proto"] || req.protocol;
        const host = req.headers["x-forwarded-host"] || req.get("host");
        const baseUrl = `${proto}://${host}`;

        const result = await provisionAndActivate(clinicId, clinic.name, clinic.slug, baseUrl);
        phoneNumber = result.phone_number;
        logger.info(`[CALENDAR_OAUTH] Auto-activated clinic ${clinicId} with phone ${phoneNumber}`);
      }
    } catch (provErr: any) {
      // Non-fatal: calendar is connected, user can manually Go Live from dashboard
      logger.error(`[CALENDAR_OAUTH] Auto-activation failed for clinic ${clinicId}:`, provErr.message);
    }

    const redirectParams = phoneNumber
      ? `calendar=success&activated=true&phone=${encodeURIComponent(phoneNumber)}`
      : "calendar=success";
    res.redirect(`/dashboard/settings?${redirectParams}`);
  } catch (err: any) {
    logger.error("[CALENDAR_OAUTH] Token exchange failed:", err.message);
    res.redirect("/dashboard/settings?calendar=error&reason=" + encodeURIComponent(err.message));
  }
});

export default router;
