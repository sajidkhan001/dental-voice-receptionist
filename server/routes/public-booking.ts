/**
 * public-booking.ts — Public (unauthenticated) API for the scheduling widget
 *
 * These endpoints are called by the embeddable booking widget on clinic websites.
 * Rate-limited and CORS-enabled for cross-origin requests.
 */

import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { queryOne, query } from "../lib/db";
import { createBooking } from "../services/booking-service";
import { sendSms } from "../services/sms-service";
import { sendEmail } from "../services/email-service";
import { sendIntakeLink } from "../services/intake-service";
import { auditLog } from "../services/audit-service";
import { checkFeatureAccess } from "../services/billing-service";
import { validate } from "../middleware/validate";
import { publicBookingSchema } from "../lib/validators";
import logger from "../lib/logger";

function xmlEncode(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const router = Router();

// Rate limit: 30 requests/min per IP
const widgetLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Too many requests, please try again later" },
});
router.use(widgetLimiter);

// CORS headers for cross-origin widget embedding
router.use((req, res, next) => {
    const origin = req.headers.origin || req.headers["x-forwarded-proto"] || "*";
    const allowed = process.env.CORS_ORIGIN || "*";

    if (origin && allowed !== "*") {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }

    next();
});

/**
 * GET /api/public/clinic/:clinicId
 * Get clinic info for the widget (name, services, providers, hours)
 */
router.get("/clinic/:clinicId", async (req: Request, res: Response) => {
  try {
    const clinic = await queryOne<{
      id: string;
      name: string;
      phone: string;
      address: string;
      hours: any;
      widget_enabled: boolean;
      widget_color: string;
    }>(
      `SELECT id, name, phone, address, hours, widget_enabled, widget_color
       FROM clinics WHERE id = $1 AND status = 'active'`,
      [req.params.clinicId]
    );

    if (!clinic || !clinic.widget_enabled) {
      res.status(404).json({ error: "Clinic not found or widget not enabled" });
      return;
    }

    // Check billing tier allows booking widget
    const hasWidget = await checkFeatureAccess(clinic.id, "booking_widget");
    if (!hasWidget) {
      res.status(403).json({ error: "Booking widget not available on clinic's current plan" });
      return;
    }

    const services = await query<{ id: string; name: string; slug: string; duration_minutes: number }>(
      `SELECT id, name, slug, duration_minutes FROM services
       WHERE clinic_id = $1 AND is_active = true ORDER BY name`,
      [req.params.clinicId]
    );

    const providers = await query<{ id: string; name: string; specialty: string; working_days: number[] }>(
      `SELECT id, name, specialty, working_days FROM providers
       WHERE clinic_id = $1 AND is_active = true ORDER BY name`,
      [req.params.clinicId]
    );

    res.json({
      clinic: {
        id: clinic.id,
        name: clinic.name,
        phone: clinic.phone,
        address: clinic.address,
        hours: clinic.hours,
        color: clinic.widget_color,
      },
      services,
      providers,
    });
  } catch (err: any) {
    res.status(404).json({ error: "Clinic not found" });
  }
});

/**
 * GET /api/public/available-slots
 * Get available time slots for a given clinic, date, and service
 */
router.get("/available-slots", async (req: Request, res: Response) => {
  const { clinicId, date, serviceId, providerId } = req.query;

  if (!clinicId || !date) {
    res.status(400).json({ error: "clinicId and date are required" });
    return;
  }

  try {
    // Get clinic calendar config
    const clinic = await queryOne<{
      google_refresh_token: string | null;
      google_calendar_id: string;
      widget_enabled: boolean;
    }>(
      `SELECT google_refresh_token, google_calendar_id, widget_enabled
       FROM clinics WHERE id = $1 AND status = 'active'`,
      [clinicId as string]
    );

    if (!clinic || !clinic.widget_enabled) {
      res.status(404).json({ error: "Clinic not found or widget not enabled" });
      return;
    }

    const hasWidget = await checkFeatureAccess(clinicId as string, "booking_widget");
    if (!hasWidget) {
      res.status(403).json({ error: "Booking widget not available on clinic's current plan" });
      return;
    }

    // Get service duration
    let duration = 60;
    if (serviceId) {
      const svc = await queryOne<{ duration_minutes: number }>(
        `SELECT duration_minutes FROM services WHERE id = $1 AND clinic_id = $2`,
        [serviceId as string, clinicId as string]
      );
      if (svc) duration = svc.duration_minutes;
    }

    // Get provider schedule
    const providerConditions = providerId
      ? `id = $2 AND clinic_id = $1`
      : `clinic_id = $1`;
    const providerParams = providerId ? [clinicId as string, providerId as string] : [clinicId as string];

    const providers = await query<{
      id: string;
      name: string;
      working_days: number[];
      start_hour: number;
      end_hour: number;
      lunch_start: number;
      lunch_end: number;
    }>(
      `SELECT id, name, working_days, start_hour, end_hour, lunch_start, lunch_end
       FROM providers WHERE ${providerConditions} AND is_active = true`,
      providerParams
    );

    // Get existing bookings for the date
    const existingBookings = await query<{
      start_time: string;
      duration_minutes: number;
      provider_id: string;
    }>(
      `SELECT start_time::text, duration_minutes, provider_id FROM bookings
       WHERE clinic_id = $1 AND appointment_date = $2 AND status IN ('confirmed', 'completed')`,
      [clinicId as string, date as string]
    );

    const dateObj = new Date(date as string);
    const dayOfWeek = dateObj.getDay();
    const today = new Date();
    const isToday = dateObj.toDateString() === today.toDateString();
    const currentHour = today.getHours() + today.getMinutes() / 60;

    const slots: { time: string; provider_id: string; provider_name: string }[] = [];

    for (const provider of providers) {
      if (!provider.working_days.includes(dayOfWeek)) continue;

      const busySlots = existingBookings
        .filter((b) => b.provider_id === provider.id)
        .map((b) => {
          const [h, m] = b.start_time.split(":").map(Number);
          return { start: h * 60 + m, end: h * 60 + m + b.duration_minutes };
        });

      const startMin = Math.ceil(provider.start_hour * 60);
      const endMin = Math.floor(provider.end_hour * 60);
      const lunchStartMin = provider.lunch_start > 0 ? Math.floor(provider.lunch_start * 60) : 0;
      const lunchEndMin = provider.lunch_end > 0 ? Math.ceil(provider.lunch_end * 60) : 0;

      for (let m = startMin; m + duration <= endMin; m += 15) {
        // Skip lunch
        if (lunchStartMin > 0 && m < lunchEndMin && m + duration > lunchStartMin) continue;

        // Skip past times today
        if (isToday && m / 60 < currentHour + 0.5) continue;

        // Check conflicts with existing bookings (including 15-min buffer)
        const hasConflict = busySlots.some(
          (b) => m < b.end + 15 && m + duration > b.start - 15
        );
        if (hasConflict) continue;

        const hour = Math.floor(m / 60);
        const min = m % 60;
        const ampm = hour >= 12 ? "PM" : "AM";
        const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;

        slots.push({
          time: `${h12}:${String(min).padStart(2, "0")} ${ampm}`,
          provider_id: provider.id,
          provider_name: provider.name,
        });
      }
    }

    res.json({ slots, date });
  } catch (err: any) {
    logger.error("[WIDGET] Available slots error:", err.message);
    res.status(500).json({ error: "Failed to check availability" });
  }
});

/**
 * POST /api/public/book
 * Create a booking from the widget
 */
router.post("/book", validate(publicBookingSchema), async (req: Request, res: Response) => {
  const {
    clinicId, providerId, serviceId,
    patientName, patientPhone, patientEmail, patientInsurance,
    date, time, isNewPatient,
  } = req.body;

  try {
    // Verify clinic exists and widget is enabled
    const clinic = await queryOne<{ id: string; name: string; widget_enabled: boolean }>(
      `SELECT id, name, widget_enabled FROM clinics WHERE id = $1 AND status = 'active'`,
      [clinicId]
    );

    if (!clinic || !clinic.widget_enabled) {
      res.status(404).json({ error: "Clinic not found or widget not enabled" });
      return;
    }

    const hasWidget = await checkFeatureAccess(clinicId, "booking_widget");
    if (!hasWidget) {
      res.status(403).json({ error: "Booking widget not available on clinic's current plan" });
      return;
    }

    // Get service duration
    let durationMinutes = 60;
    if (serviceId) {
      const svc = await queryOne<{ duration_minutes: number }>(
        `SELECT duration_minutes FROM services WHERE id = $1`,
        [serviceId]
      );
      if (svc) durationMinutes = svc.duration_minutes;
    }

    // Parse time to 24h format for DB
    const timeMatch = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    let startTime = time;
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const minutes = timeMatch[2];
      const ampm = timeMatch[3].toUpperCase();
      if (ampm === "PM" && hours !== 12) hours += 12;
      if (ampm === "AM" && hours === 12) hours = 0;
      startTime = `${String(hours).padStart(2, "0")}:${minutes}`;
    }

    const bookingId = await createBooking(clinicId, {
      providerId: providerId || undefined,
      serviceId: serviceId || undefined,
      patientName,
      patientPhone,
      patientEmail: patientEmail || undefined,
      patientInsurance: patientInsurance || undefined,
      isNewPatient: isNewPatient ?? true,
      appointmentDate: date,
      startTime,
      durationMinutes,
    });

    // Update booking source
    const { execute } = await import("../lib/db");
    await execute(
      `UPDATE bookings SET source = 'widget' WHERE id = $1`,
      [bookingId]
    );

    // Send confirmation SMS
    if (patientPhone) {
      await sendSms(
        patientPhone,
        `Your appointment at ${clinic.name} is confirmed for ${date} at ${time}. We look forward to seeing you! Reply CANCEL to cancel.`
      );
    }

    // Send confirmation email
    if (patientEmail) {
      await sendEmail({
        to: patientEmail,
        subject: `Appointment Confirmed — ${clinic.name}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #1a1a1a;">Appointment Confirmed</h2>
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6;">
              Hi ${xmlEncode(patientName)}, your appointment at <strong>${xmlEncode(clinic.name)}</strong> has been confirmed.
            </p>
            <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <p style="margin: 4px 0; color: #333;"><strong>Date:</strong> ${xmlEncode(date)}</p>
              <p style="margin: 4px 0; color: #333;"><strong>Time:</strong> ${xmlEncode(time)}</p>
            </div>
            ${isNewPatient ? `<p style="color: #4a4a4a;">Since this is your first visit, please arrive 15 minutes early.</p>` : ""}
            <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
            <p style="color: #9b9b9b; font-size: 12px;">${xmlEncode(clinic.name)}</p>
          </div>
        `,
      });
    }

    // Send intake form link for new patients
    if (isNewPatient) {
      const proto = req.headers["x-forwarded-proto"] || req.protocol;
      const host = req.headers["x-forwarded-host"] || req.get("host");
      const baseUrl = `${proto}://${host}`;
      await sendIntakeLink(clinicId, bookingId, patientName, patientPhone, patientEmail, baseUrl);
    }

    await auditLog({
      clinicId,
      userId: "widget",
      action: "booking.widget_created",
      resourceType: "booking",
      resourceId: bookingId,
      details: { patient_name: patientName, date, time },
    });

    res.json({
      success: true,
      bookingId,
      message: `Appointment confirmed for ${date} at ${time}`,
    });
  } catch (err: any) {
    logger.error("[WIDGET] Booking error:", err.message);
    res.status(500).json({ error: "Failed to book appointment" });
  }
});

export default router;
