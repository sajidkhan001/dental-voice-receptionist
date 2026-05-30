/**
 * sms-webhook.ts — Handle inbound SMS (2-way patient replies).
 * Twilio sends incoming SMS to POST /webhook/sms.
 * Patients can reply YES to confirm or CANCEL to cancel.
 */

import { Router, Request, Response } from "express";
import crypto from "crypto";
import { query, queryOne, execute, isDbAvailable } from "../lib/db";
import { sendSms } from "../services/sms-service";
import logger from "../lib/logger";

const router = Router();

function verifyTelnyxSignature(req: Request): boolean {
  const secret = process.env.TELNYX_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      logger.error("[SMS_WEBHOOK] TELNYX_WEBHOOK_SECRET not set in production — rejecting webhook");
      return false;
    }
    logger.warn("[SMS_WEBHOOK] TELNYX_WEBHOOK_SECRET not set — accepting all SMS (dev only)");
    return true;
  }

  const signature = req.headers["telnyx-signature"] as string;
  const timestamp = req.headers["telnyx-timestamp"] as string;
  if (!signature || !timestamp) return false;

  const payload = JSON.stringify(req.body);
  const expected = crypto
    .createHmac("sha256", secret)
    .update(timestamp + payload)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// POST /webhook/sms — Twilio inbound SMS webhook
router.post("/", async (req: Request, res: Response) => {
  if (!verifyTelnyxSignature(req)) {
    logger.warn("[SMS_WEBHOOK] Invalid Telnyx signature");
    res.type("text/xml").send("<Response></Response>");
    return;
  }

  const { From, Body } = req.body;

  if (!From || !Body) {
    res.status(400).send("<Response></Response>");
    return;
  }

  const phone = From.replace(/\D/g, "").slice(-10); // normalize to 10 digits
  const message = Body.trim().toUpperCase();

  logger.info(`[SMS_WEBHOOK] Inbound from ${From}: "${Body}"`);

  if (!isDbAvailable()) {
    logger.info("[SMS_WEBHOOK] No DB — ignoring inbound SMS");
    res.type("text/xml").send("<Response></Response>");
    return;
  }

  try {
    // Find the most recent upcoming confirmed booking for this phone number
    const booking = await queryOne<{
      id: string;
      clinic_id: string;
      patient_name: string;
      appointment_date: string;
      start_time: string;
      service_name: string | null;
      clinic_name: string;
      clinic_phone: string | null;
    }>(
      `SELECT b.id, b.clinic_id, b.patient_name, b.appointment_date, b.start_time,
              s.name as service_name, c.name as clinic_name, c.phone as clinic_phone
       FROM bookings b
       JOIN clinics c ON b.clinic_id = c.id
       LEFT JOIN services s ON b.service_id = s.id
       WHERE b.patient_phone LIKE $1
         AND b.status = 'confirmed'
         AND b.appointment_date >= CURRENT_DATE
       ORDER BY b.appointment_date, b.start_time
       LIMIT 1`,
      [`%${phone}`]
    );

    if (!booking) {
      logger.info(`[SMS_WEBHOOK] No upcoming booking found for ${From}`);
      res.type("text/xml").send("<Response></Response>");
      return;
    }

    if (message === "YES" || message === "CONFIRM" || message === "Y") {
      // Mark as confirmed
      await execute(
        `UPDATE bookings SET patient_confirmed = true, updated_at = NOW() WHERE id = $1`,
        [booking.id]
      );

      const reply = `Confirmed! See you at ${booking.start_time} on ${booking.appointment_date}. - ${booking.clinic_name}`;
      await sendSms(From, reply);

      logger.info(`[SMS_WEBHOOK] Booking ${booking.id} confirmed by patient`);
    } else if (message === "CANCEL" || message === "NO" || message === "N") {
      // Cancel booking
      await execute(
        `UPDATE bookings SET status = 'cancelled', patient_confirmed = false, updated_at = NOW() WHERE id = $1`,
        [booking.id]
      );

      const clinicPhone = booking.clinic_phone || "our office";
      const reply = `Your appointment on ${booking.appointment_date} has been cancelled. Call ${clinicPhone} to reschedule. - ${booking.clinic_name}`;
      await sendSms(From, reply);

      logger.info(`[SMS_WEBHOOK] Booking ${booking.id} cancelled by patient`);
    } else {
      // Unrecognized reply
      const reply = `Reply YES to confirm or CANCEL to cancel your upcoming appointment. - ${booking.clinic_name}`;
      await sendSms(From, reply);
    }
  } catch (err: any) {
    logger.error("[SMS_WEBHOOK] Error processing inbound SMS:", err.message);
  }

  // Twilio expects TwiML response
  res.type("text/xml").send("<Response></Response>");
});

export default router;
