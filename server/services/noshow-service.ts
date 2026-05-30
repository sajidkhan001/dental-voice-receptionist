/**
 * noshow-service.ts — Auto-detect no-shows and send follow-ups
 *
 * Follows the same scheduler pattern as reminder-service.ts:
 * - Runs every 15 min via setInterval
 * - detectAndMarkNoShows(): marks confirmed bookings as no_show after 15-min grace
 * - sendNoShowFollowups(): SMS to no-shows not yet contacted
 */

import { query, queryOne, execute, isDbAvailable } from "../lib/db";
import { sendSms } from "./sms-service";
import { auditLog } from "./audit-service";
import logger from "../lib/logger";

interface NoShowBooking {
  id: string;
  clinic_id: string;
  patient_name: string;
  patient_phone: string | null;
  appointment_date: string;
  start_time: string;
  provider_name: string | null;
  service_name: string | null;
  clinic_name: string;
  clinic_phone: string | null;
}

/**
 * Auto-detect and mark no-shows.
 * A booking is no-show if: status = 'confirmed' AND appointment_time + 15 min < NOW()
 */
export async function detectAndMarkNoShows(): Promise<number> {
  if (!isDbAvailable()) return 0;

  try {
    const result = await query<{ id: string; clinic_id: string; patient_name: string }>(
      `UPDATE bookings
       SET status = 'no_show', updated_at = NOW()
       WHERE status = 'confirmed'
         AND (appointment_date + start_time + INTERVAL '15 minutes') < NOW()
       RETURNING id, clinic_id, patient_name`
    );

    if (result.length > 0) {
      logger.info(`[NOSHOW] Auto-marked ${result.length} bookings as no_show`);
      for (const row of result) {
        await auditLog({
          clinicId: row.clinic_id,
          userId: "system",
          action: "booking.auto_noshow",
          resourceType: "booking",
          resourceId: row.id,
          details: { patient_name: row.patient_name },
        });
      }
    }

    return result.length;
  } catch (err: any) {
    logger.error("[NOSHOW] Detection failed:", err.message);
    return 0;
  }
}

/**
 * Send SMS follow-ups to no-show patients who haven't been contacted yet.
 * Only sends to bookings with a phone number and no existing follow-up.
 */
export async function sendNoShowFollowups(): Promise<number> {
  if (!isDbAvailable()) return 0;

  try {
    const noShows = await query<NoShowBooking>(
      `SELECT b.id, b.clinic_id, b.patient_name, b.patient_phone,
              b.appointment_date, b.start_time,
              p.name as provider_name, s.name as service_name,
              c.name as clinic_name, c.phone as clinic_phone
       FROM bookings b
       LEFT JOIN providers p ON b.provider_id = p.id
       LEFT JOIN services s ON b.service_id = s.id
       JOIN clinics c ON b.clinic_id = c.id
       WHERE b.status = 'no_show'
         AND b.patient_phone IS NOT NULL
         AND b.appointment_date >= CURRENT_DATE - INTERVAL '1 day'
         AND NOT EXISTS (
           SELECT 1 FROM noshow_followups nf
           WHERE nf.booking_id = b.id AND nf.followup_type = 'sms_initial'
         )
       ORDER BY b.appointment_date DESC, b.start_time DESC
       LIMIT 50`
    );

    let sent = 0;
    for (const booking of noShows) {
      try {
        const service = booking.service_name || "your appointment";
        const clinic = booking.clinic_name;
        const body =
          `Hi ${booking.patient_name}, we missed you at ${clinic} today for ${service}. ` +
          `We hope everything is okay! Would you like to reschedule? ` +
          `Reply YES to reschedule or call us at ${booking.clinic_phone || "our office"}.`;

        await sendSms(booking.patient_phone!, body);

        // Record the follow-up
        await execute(
          `INSERT INTO noshow_followups (clinic_id, booking_id, followup_type, outcome, message_body)
           VALUES ($1, $2, 'sms_initial', 'sent', $3)`,
          [booking.clinic_id, booking.id, body]
        );

        await auditLog({
          clinicId: booking.clinic_id,
          userId: "system",
          action: "noshow.sms_followup",
          resourceType: "booking",
          resourceId: booking.id,
          details: { patient_name: booking.patient_name, patient_phone: booking.patient_phone },
        });

        sent++;
      } catch (err: any) {
        logger.error(`[NOSHOW] SMS follow-up failed for booking ${booking.id}:`, err.message);

        await execute(
          `INSERT INTO noshow_followups (clinic_id, booking_id, followup_type, outcome, notes)
           VALUES ($1, $2, 'sms_initial', 'failed', $3)`,
          [booking.clinic_id, booking.id, err.message]
        );
      }
    }

    if (sent > 0) {
      logger.info(`[NOSHOW] Sent ${sent} SMS follow-ups`);
    }
    return sent;
  } catch (err: any) {
    logger.error("[NOSHOW] Follow-up check failed:", err.message);
    return 0;
  }
}

/**
 * Manually trigger a follow-up for a specific booking (from dashboard action).
 */
export async function triggerFollowup(
  clinicId: string,
  bookingId: string,
  type: "sms" | "ai_call",
  userId: string
): Promise<{ success: boolean; message: string }> {
  // Verify booking belongs to clinic and is a no-show
  const booking = await queryOne<NoShowBooking>(
    `SELECT b.id, b.clinic_id, b.patient_name, b.patient_phone,
            b.appointment_date, b.start_time,
            p.name as provider_name, s.name as service_name,
            c.name as clinic_name, c.phone as clinic_phone
     FROM bookings b
     LEFT JOIN providers p ON b.provider_id = p.id
     LEFT JOIN services s ON b.service_id = s.id
     JOIN clinics c ON b.clinic_id = c.id
     WHERE b.id = $1 AND b.clinic_id = $2 AND b.status = 'no_show'`,
    [bookingId, clinicId]
  );

  if (!booking) {
    return { success: false, message: "Booking not found or not a no-show" };
  }

  if (!booking.patient_phone) {
    return { success: false, message: "No phone number on file for this patient" };
  }

  if (type === "sms") {
    const service = booking.service_name || "your appointment";
    const body =
      `Hi ${booking.patient_name}, we noticed you missed ${service} at ${booking.clinic_name}. ` +
      `We'd love to get you rescheduled! Reply YES or call us at ${booking.clinic_phone || "our office"}.`;

    await sendSms(booking.patient_phone, body);

    await execute(
      `INSERT INTO noshow_followups (clinic_id, booking_id, followup_type, outcome, message_body)
       VALUES ($1, $2, 'sms_retry', 'sent', $3)`,
      [clinicId, bookingId, body]
    );

    await auditLog({
      clinicId,
      userId,
      action: "noshow.manual_sms",
      resourceType: "booking",
      resourceId: bookingId,
      details: { patient_name: booking.patient_name },
    });

    return { success: true, message: `SMS sent to ${booking.patient_phone}` };
  }

  if (type === "ai_call") {
    // AI callback — simulation mode or real
    const callDetails = {
      patient_name: booking.patient_name,
      patient_phone: booking.patient_phone,
      service_name: booking.service_name,
      clinic_name: booking.clinic_name,
      appointment_date: booking.appointment_date,
    };

    if (process.env.SIMULATION_MODE !== "false" || !process.env.TELNYX_API_KEY) {
      // Simulation: log to DB only
      logger.info(`[NOSHOW] AI callback simulation for ${booking.patient_name}: ${booking.patient_phone}`);

      await execute(
        `INSERT INTO noshow_followups (clinic_id, booking_id, followup_type, outcome, notes)
         VALUES ($1, $2, 'ai_call', 'sent', $3)`,
        [clinicId, bookingId, JSON.stringify({ mode: "simulation", ...callDetails })]
      );

      await auditLog({
        clinicId,
        userId,
        action: "noshow.ai_callback",
        resourceType: "booking",
        resourceId: bookingId,
        details: { ...callDetails, mode: "simulation" },
      });

      return { success: true, message: `AI callback queued (simulation) for ${booking.patient_phone}` };
    }

    // Production: use Telnyx to initiate outbound call to our voice pipeline
    try {
      const Telnyx = (await import("telnyx")).default;
      const telnyx = new Telnyx({ apiKey: process.env.TELNYX_API_KEY! });

      // Get clinic's phone number
      const clinic = await queryOne<{ telnyx_phone_number: string }>(
        `SELECT telnyx_phone_number FROM clinics WHERE id = $1`,
        [clinicId]
      );

      if (!clinic?.telnyx_phone_number) {
        return { success: false, message: "Clinic has no phone number configured" };
      }

      const baseUrl = process.env.BASE_URL || "https://localhost:3001";
      const call = await telnyx.calls.dial({
        to: booking.patient_phone!,
        from: clinic.telnyx_phone_number,
        connection_id: process.env.TELNYX_CONNECTION_ID!,
        webhook_url: `${baseUrl}/webhook/voice`,
      });

      const callId = call.data?.call_control_id || `telnyx-${Date.now()}`;

      await execute(
        `INSERT INTO noshow_followups (clinic_id, booking_id, followup_type, outcome, call_sid, notes)
         VALUES ($1, $2, 'ai_call', 'sent', $3, $4)`,
        [clinicId, bookingId, callId, JSON.stringify(callDetails)]
      );

      await auditLog({
        clinicId,
        userId,
        action: "noshow.ai_callback",
        resourceType: "booking",
        resourceId: bookingId,
        details: { ...callDetails, call_id: callId },
      });

      return { success: true, message: `AI calling ${booking.patient_phone} (ID: ${callId})` };
    } catch (err: any) {
      logger.error(`[NOSHOW] AI callback failed for ${bookingId}:`, err.message);
      await execute(
        `INSERT INTO noshow_followups (clinic_id, booking_id, followup_type, outcome, notes)
         VALUES ($1, $2, 'ai_call', 'failed', $3)`,
        [clinicId, bookingId, err.message]
      );
      return { success: false, message: `AI callback failed: ${err.message}` };
    }
  }

  return { success: false, message: "Invalid follow-up type" };
}

/**
 * Get follow-up history for a booking
 */
export async function getFollowups(clinicId: string, bookingId: string): Promise<any[]> {
  return query(
    `SELECT id, followup_type, outcome, call_sid, message_body, notes, created_at
     FROM noshow_followups
     WHERE clinic_id = $1 AND booking_id = $2
     ORDER BY created_at DESC`,
    [clinicId, bookingId]
  );
}

/**
 * Run no-show detection + follow-up in one pass (called by scheduler)
 */
async function runNoShowCheck(): Promise<void> {
  const marked = await detectAndMarkNoShows();
  const sent = await sendNoShowFollowups();

  if (marked > 0 || sent > 0) {
    logger.info(`[NOSHOW] Check complete: ${marked} marked, ${sent} SMS sent`);
  }
}

/**
 * Start the no-show scheduler. Call from server startup.
 */
let noshowInterval: ReturnType<typeof setInterval> | null = null;

export function startNoShowScheduler(): void {
  if (!isDbAvailable()) {
    logger.info("[NOSHOW] Skipped — no database available");
    return;
  }

  if (noshowInterval) {
    clearInterval(noshowInterval);
    noshowInterval = null;
  }

  const INTERVAL_MS = 15 * 60 * 1000;

  setTimeout(() => {
    runNoShowCheck();
    noshowInterval = setInterval(runNoShowCheck, INTERVAL_MS);
  }, 45_000);

  logger.info("[NOSHOW] Scheduler started (every 15 min)");
}

export function stopNoShowScheduler(): void {
  if (noshowInterval) {
    clearInterval(noshowInterval);
    noshowInterval = null;
    logger.info("[NOSHOW] Scheduler stopped");
  }
}
