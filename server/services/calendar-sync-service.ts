/**
 * calendar-sync-service.ts — Google Calendar bidirectional sync via webhooks
 *
 * Registers watch channels on clinic calendars, receives push notifications,
 * syncs external changes (PMS → Google Calendar → our DB), and detects conflicts.
 */

import { google } from "googleapis";
import { query, queryOne, execute, isDbAvailable } from "../lib/db";
import { decryptField } from "../lib/encryption";
import { getClinicCredentials } from "./credentials-service";
import { sendSms } from "./sms-service";
import { auditLog } from "./audit-service";
import logger from "../lib/logger";

interface ClinicCalendarConfig {
  id: string;
  name: string;
  google_client_id: string;
  google_client_secret: string;
  google_refresh_token: string;
  google_calendar_id: string;
  google_calendar_watch_id: string | null;
  google_calendar_watch_expiry: string | null;
  google_calendar_sync_token: string | null;
  phone: string | null;
}

async function getOAuth2Client(clinic: ClinicCalendarConfig) {
  const credentials = await getClinicCredentials(clinic.id);
  const auth = new google.auth.OAuth2(
    decryptField(clinic.google_client_id) || credentials.googleClientId || undefined,
    decryptField(clinic.google_client_secret) || credentials.googleClientSecret || undefined
  );
  auth.setCredentials({ refresh_token: decryptField(clinic.google_refresh_token) || clinic.google_refresh_token });
  return auth;
}

/**
 * Register a Google Calendar watch channel for a clinic.
 * Google will POST to our webhook when calendar changes occur.
 */
export async function watchCalendar(clinicId: string, webhookUrl: string): Promise<{
  watchId: string;
  expiration: string;
}> {
  const clinic = await queryOne<ClinicCalendarConfig>(
    `SELECT id, name, google_client_id, google_client_secret, google_refresh_token,
            google_calendar_id, google_calendar_watch_id, google_calendar_watch_expiry,
            google_calendar_sync_token, phone
     FROM clinics WHERE id = $1 AND google_refresh_token IS NOT NULL`,
    [clinicId]
  );

  if (!clinic) {
    throw new Error("Clinic not found or Google Calendar not connected");
  }

  const auth = await getOAuth2Client(clinic);
  const calendar = google.calendar({ version: "v3", auth });

  // Stop existing watch if any
  if (clinic.google_calendar_watch_id) {
    try {
      await calendar.channels.stop({
        requestBody: {
          id: clinic.google_calendar_watch_id,
          resourceId: clinic.google_calendar_watch_id,
        },
      });
    } catch {
      // Ignore — old channel may have expired
    }
  }

  const channelId = `dental-sync-${clinicId}-${Date.now()}`;
  const expiration = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days

  const res = await calendar.events.watch({
    calendarId: clinic.google_calendar_id || "primary",
    requestBody: {
      id: channelId,
      type: "web_hook",
      address: webhookUrl,
      expiration: String(expiration),
      params: { ttl: "604800" }, // 7 days in seconds
    },
  });

  const watchId = res.data.id!;
  const expirationDate = new Date(parseInt(res.data.expiration!)).toISOString();

  await execute(
    `UPDATE clinics SET google_calendar_watch_id = $1, google_calendar_watch_expiry = $2, updated_at = NOW()
     WHERE id = $3`,
    [watchId, expirationDate, clinicId]
  );

  await auditLog({
    clinicId,
    userId: "system",
    action: "calendar.watch_registered",
    resourceType: "clinic",
    resourceId: clinicId,
    details: { watch_id: watchId, expiration: expirationDate },
  });

  logger.info(`[CALENDAR-SYNC] Watch registered for clinic ${clinicId}, expires ${expirationDate}`);
  return { watchId, expiration: expirationDate };
}

/**
 * Handle a Google Calendar push notification.
 * Fetches recent changes and syncs with our bookings table.
 */
export async function handleCalendarChange(clinicId: string): Promise<{
  synced: number;
  conflicts: number;
}> {
  const clinic = await queryOne<ClinicCalendarConfig>(
    `SELECT id, name, google_client_id, google_client_secret, google_refresh_token,
            google_calendar_id, google_calendar_sync_token, phone
     FROM clinics WHERE id = $1`,
    [clinicId]
  );

  if (!clinic || !clinic.google_refresh_token) {
    logger.warn(`[CALENDAR-SYNC] No calendar config for clinic ${clinicId}`);
    return { synced: 0, conflicts: 0 };
  }

  const auth = await getOAuth2Client(clinic);
  const calendar = google.calendar({ version: "v3", auth });

  // Use sync token for incremental sync, or full sync for first run
  const listParams: any = {
    calendarId: clinic.google_calendar_id || "primary",
    singleEvents: true,
    maxResults: 100,
    timeMin: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Last 24h
    timeMax: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // Next 90 days
  };

  if (clinic.google_calendar_sync_token) {
    listParams.syncToken = clinic.google_calendar_sync_token;
    delete listParams.timeMin;
    delete listParams.timeMax;
  }

  let events;
  try {
    events = await calendar.events.list(listParams);
  } catch (err: any) {
    if (err.code === 410) {
      // Sync token invalid — full sync needed
      delete listParams.syncToken;
      listParams.timeMin = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      listParams.timeMax = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
      events = await calendar.events.list(listParams);
    } else {
      throw err;
    }
  }

  // Process events before saving sync token
  let synced = 0;
  let conflicts = 0;

  for (const event of events.data.items || []) {
    if (!event.id || !event.start?.dateTime) continue;

    const existing = await queryOne<{ id: string; status: string; start_time: string }>(
      `SELECT id, status, start_time::text FROM bookings WHERE google_event_id = $1 AND clinic_id = $2`,
      [event.id, clinicId]
    );

    if (existing) {
      if (event.status === "cancelled" && existing.status !== "cancelled") {
        await execute(
          `UPDATE bookings SET status = 'cancelled', pms_synced_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [existing.id]
        );
        synced++;
      }
    } else if (event.status !== "cancelled") {
      const eventStart = new Date(event.start.dateTime);
      const eventEnd = event.end?.dateTime ? new Date(event.end.dateTime) : new Date(eventStart.getTime() + 60 * 60000);
      const eventDate = eventStart.toISOString().split("T")[0];
      const eventTime = eventStart.toTimeString().slice(0, 5);

      const conflicting = await query<{ id: string; patient_name: string; start_time: string }>(
        `SELECT id, patient_name, start_time::text FROM bookings
         WHERE clinic_id = $1 AND appointment_date = $2 AND status IN ('confirmed', 'completed')
           AND (start_time, (start_time + (duration_minutes || ' minutes')::interval))
           OVERLAPS ($3::time, $4::time)`,
        [clinicId, eventDate, eventTime, eventEnd.toTimeString().slice(0, 5)]
      );

      if (conflicting.length > 0) {
        conflicts++;
        for (const booking of conflicting) {
          await execute(
            `UPDATE bookings SET conflict_detected = true, updated_at = NOW() WHERE id = $1`,
            [booking.id]
          );
        }

        if (clinic.phone) {
          const conflictNames = conflicting.map((b) => b.patient_name).join(", ");
          await sendSms(
            clinic.phone,
            `Calendar Conflict Alert: External event "${event.summary || "Untitled"}" on ${eventDate} at ${eventTime} conflicts with booking(s): ${conflictNames}. Please review in your dashboard.`,
            undefined,
            clinicId
          );
        }
      }

      synced++;
    }
  }

  // Save sync token AFTER processing events
  if (events.data.nextSyncToken) {
    await execute(
      `UPDATE clinics SET google_calendar_sync_token = $1, google_calendar_last_sync = NOW() WHERE id = $2`,
      [events.data.nextSyncToken, clinicId]
    );
  }

  await execute(
    `UPDATE clinics SET google_calendar_last_sync = NOW() WHERE id = $1`,
    [clinicId]
  );

  logger.info(`[CALENDAR-SYNC] Clinic ${clinicId}: ${synced} synced, ${conflicts} conflicts`);
  return { synced, conflicts };
}

/**
 * Get sync status for a clinic's calendar.
 */
export async function getSyncStatus(clinicId: string): Promise<{
  connected: boolean;
  watch_active: boolean;
  watch_expiry: string | null;
  last_sync: string | null;
  conflicts: number;
}> {
  const clinic = await queryOne<{
    google_refresh_token: string | null;
    google_calendar_watch_id: string | null;
    google_calendar_watch_expiry: string | null;
    google_calendar_last_sync: string | null;
  }>(
    `SELECT google_refresh_token, google_calendar_watch_id,
            google_calendar_watch_expiry, google_calendar_last_sync
     FROM clinics WHERE id = $1`,
    [clinicId]
  );

  if (!clinic) {
    return { connected: false, watch_active: false, watch_expiry: null, last_sync: null, conflicts: 0 };
  }

  const watchExpiry = clinic.google_calendar_watch_expiry
    ? new Date(clinic.google_calendar_watch_expiry)
    : null;

  const conflictCount = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM bookings
     WHERE clinic_id = $1 AND conflict_detected = true AND status NOT IN ('cancelled', 'completed')`,
    [clinicId]
  );

  return {
    connected: !!clinic.google_refresh_token,
    watch_active: !!watchExpiry && watchExpiry > new Date(),
    watch_expiry: clinic.google_calendar_watch_expiry,
    last_sync: clinic.google_calendar_last_sync,
    conflicts: parseInt(conflictCount?.count || "0", 10),
  };
}

/**
 * Re-register watch channels that are about to expire (< 24h remaining).
 * Run on a schedule (e.g., every 6 hours).
 */
export async function renewExpiringWatches(webhookUrl: string): Promise<number> {
  if (!isDbAvailable()) return 0;

  const expiring = await query<{ id: string }>(
    `SELECT id FROM clinics
     WHERE google_refresh_token IS NOT NULL
       AND google_calendar_watch_expiry IS NOT NULL
       AND google_calendar_watch_expiry < NOW() + INTERVAL '24 hours'
       AND status = 'active'`
  );

  let renewed = 0;
  for (const clinic of expiring) {
    try {
      await watchCalendar(clinic.id, webhookUrl);
      renewed++;
    } catch (err: any) {
      logger.error(`[CALENDAR-SYNC] Failed to renew watch for clinic ${clinic.id}:`, err.message);
    }
  }

  if (renewed > 0) {
    logger.info(`[CALENDAR-SYNC] Renewed ${renewed} expiring watch channels`);
  }
  return renewed;
}

/**
 * Start the calendar sync scheduler. Renews watch channels every 6 hours.
 */
let calendarSyncInterval: ReturnType<typeof setInterval> | null = null;

export function startCalendarSyncScheduler(webhookUrl: string): void {
  if (!isDbAvailable()) {
    logger.info("[CALENDAR-SYNC] Skipped — no database available");
    return;
  }

  if (calendarSyncInterval) {
    clearInterval(calendarSyncInterval);
    calendarSyncInterval = null;
  }

  const INTERVAL_MS = 6 * 60 * 60 * 1000;

  setTimeout(() => {
    renewExpiringWatches(webhookUrl);
    calendarSyncInterval = setInterval(() => renewExpiringWatches(webhookUrl), INTERVAL_MS);
  }, 120_000);

  logger.info("[CALENDAR-SYNC] Scheduler started (every 6 hours)");
}

export function stopCalendarSyncScheduler(): void {
  if (calendarSyncInterval) {
    clearInterval(calendarSyncInterval);
    calendarSyncInterval = null;
  }
}
