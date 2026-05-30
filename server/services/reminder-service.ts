/**
 * reminder-service.ts — Automated appointment reminders (24h + 1h before).
 * Runs on a schedule (setInterval) from server startup.
 */

import { query, execute, isDbAvailable } from "../lib/db";
import { sendSms } from "./sms-service";
import logger from "../lib/logger";

interface UpcomingBooking {
  id: string;
  clinic_id: string;
  patient_name: string;
  patient_phone: string;
  appointment_date: string;
  start_time: string;
  duration_minutes: number;
  provider_name: string | null;
  service_name: string | null;
  clinic_name: string;
  clinic_phone: string | null;
  reminder_sent_24h: boolean;
  reminder_sent_1h: boolean;
}

/**
 * Check for upcoming appointments and send reminders.
 * Called every 15 minutes via setInterval.
 */
export async function checkAndSendReminders(): Promise<void> {
  if (!isDbAvailable()) return;

  try {
    // Find bookings needing 24h reminder (between 23-25 hours from now)
    const twentyFourHourBookings = await query<UpcomingBooking>(
      `SELECT b.id, b.clinic_id, b.patient_name, b.patient_phone,
              b.appointment_date, b.start_time, b.duration_minutes,
              b.reminder_sent_24h, b.reminder_sent_1h,
              p.name as provider_name, s.name as service_name,
              c.name as clinic_name, c.phone as clinic_phone
       FROM bookings b
       LEFT JOIN providers p ON b.provider_id = p.id
       LEFT JOIN services s ON b.service_id = s.id
       JOIN clinics c ON b.clinic_id = c.id
       WHERE b.status = 'confirmed'
         AND b.reminder_sent_24h = false
         AND b.patient_phone IS NOT NULL
         AND (b.appointment_date + b.start_time) BETWEEN NOW() + INTERVAL '23 hours' AND NOW() + INTERVAL '25 hours'
       LIMIT 50`
    );

    for (const booking of twentyFourHourBookings) {
      await sendReminder(booking, "24h");
    }

    // Find bookings needing 1h reminder (between 50-70 minutes from now)
    const oneHourBookings = await query<UpcomingBooking>(
      `SELECT b.id, b.clinic_id, b.patient_name, b.patient_phone,
              b.appointment_date, b.start_time, b.duration_minutes,
              b.reminder_sent_24h, b.reminder_sent_1h,
              p.name as provider_name, s.name as service_name,
              c.name as clinic_name, c.phone as clinic_phone
       FROM bookings b
       LEFT JOIN providers p ON b.provider_id = p.id
       LEFT JOIN services s ON b.service_id = s.id
       JOIN clinics c ON b.clinic_id = c.id
       WHERE b.status = 'confirmed'
         AND b.reminder_sent_1h = false
         AND b.patient_phone IS NOT NULL
         AND (b.appointment_date + b.start_time) BETWEEN NOW() + INTERVAL '50 minutes' AND NOW() + INTERVAL '70 minutes'
       LIMIT 50`
    );

    for (const booking of oneHourBookings) {
      await sendReminder(booking, "1h");
    }

    const total = twentyFourHourBookings.length + oneHourBookings.length;
    if (total > 0) {
      logger.info(`[REMINDERS] Sent ${total} reminders (${twentyFourHourBookings.length} x 24h, ${oneHourBookings.length} x 1h)`);
    }
  } catch (err: any) {
    logger.error("[REMINDERS] Check failed:", err.message);
  }
}

async function sendReminder(booking: UpcomingBooking, type: "24h" | "1h"): Promise<void> {
  const timeLabel = type === "24h" ? "tomorrow" : "in about 1 hour";
  const service = booking.service_name || "your appointment";
  const provider = booking.provider_name ? ` with ${booking.provider_name}` : "";

  const body =
    `Hi ${booking.patient_name}, reminder: your ${service} appointment${provider} at ${booking.clinic_name} is ${timeLabel} at ${booking.start_time}. ` +
    `Reply YES to confirm or CANCEL to cancel.`;

  try {
    await sendSms(booking.patient_phone, body);

    // Mark as sent
    const col = type === "24h" ? "reminder_sent_24h" : "reminder_sent_1h";
    await execute(
      `UPDATE bookings SET ${col} = true, updated_at = NOW() WHERE id = $1`,
      [booking.id]
    );

    logger.info(`[REMINDERS] ${type} reminder sent to ${booking.patient_phone} for booking ${booking.id}`);
  } catch (err: any) {
    logger.error(`[REMINDERS] Failed to send ${type} reminder for booking ${booking.id}:`, err.message);
  }
}

/**
 * Start the reminder scheduler. Call from server startup.
 */
let reminderInterval: ReturnType<typeof setInterval> | null = null;

export function startReminderScheduler(): void {
  if (!isDbAvailable()) {
    logger.info("[REMINDERS] Skipped — no database available");
    return;
  }

  if (reminderInterval) {
    clearInterval(reminderInterval);
    reminderInterval = null;
  }

  const INTERVAL_MS = 15 * 60 * 1000;

  setTimeout(() => {
    checkAndSendReminders();
    reminderInterval = setInterval(checkAndSendReminders, INTERVAL_MS);
  }, 30_000);

  logger.info("[REMINDERS] Scheduler started (every 15 min)");
}

export function stopReminderScheduler(): void {
  if (reminderInterval) {
    clearInterval(reminderInterval);
    reminderInterval = null;
    logger.info("[REMINDERS] Scheduler stopped");
  }
}
