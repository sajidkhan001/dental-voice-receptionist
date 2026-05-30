/**
 * public-intake.ts — Public (unauthenticated) API for patient intake forms
 *
 * Patients access their intake form via a unique booking ID link.
 * No auth required — the booking ID acts as a token.
 */

import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { queryOne } from "../lib/db";
import { createIntakeForm, IntakeFormData } from "../services/intake-service";
import { auditLog } from "../services/audit-service";
import logger from "../lib/logger";

const router = Router();

// Rate limit: 20 requests/min per IP
const intakeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: "Too many requests, please try again later" },
});
router.use(intakeLimiter);

// CORS for cross-origin
router.use((req, res, next) => {
    const allowed = [process.env.CORS_ORIGIN || "http://localhost:3000"];
    res.header("Access-Control-Allow-Origin", allowed);
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
});

/**
 * GET /api/public/intake/:bookingId
 * Get booking info for the intake form (so we can pre-fill patient name, etc.)
 */
router.get("/:bookingId", async (req: Request, res: Response) => {
  try {
    const booking = await queryOne<{
      id: string;
      clinic_id: string;
      patient_name: string;
      patient_phone: string | null;
      patient_email: string | null;
      patient_insurance: string | null;
      is_new_patient: boolean;
      appointment_date: string;
      start_time: string;
      intake_completed: boolean;
      clinic_name: string;
    }>(
      `SELECT b.id, b.clinic_id, b.patient_name, b.patient_phone, b.patient_email,
              b.patient_insurance, b.is_new_patient, b.appointment_date, b.start_time::text,
              b.intake_completed, c.name as clinic_name
       FROM bookings b
       JOIN clinics c ON b.clinic_id = c.id
       WHERE b.id = $1 AND b.status IN ('confirmed', 'completed')`,
      [req.params.bookingId]
    );

    if (!booking) {
      res.status(404).json({ error: "Booking not found" });
      return;
    }

    if (booking.intake_completed) {
      res.json({
        completed: true,
        message: "Intake form has already been submitted. Thank you!",
        clinicName: booking.clinic_name,
      });
      return;
    }

    res.json({
      completed: false,
      booking: {
        id: booking.id,
        patientName: booking.patient_name,
        patientPhone: booking.patient_phone,
        patientEmail: booking.patient_email,
        patientInsurance: booking.patient_insurance,
        isNewPatient: booking.is_new_patient,
        appointmentDate: booking.appointment_date,
        startTime: booking.start_time,
      },
      clinicName: booking.clinic_name,
    });
  } catch (err: any) {
    logger.error("[INTAKE-API] Get booking error:", err.message);
    res.status(500).json({ error: "Failed to load booking info" });
  }
});

/**
 * POST /api/public/intake/:bookingId
 * Submit a patient intake form
 */
router.post("/:bookingId", async (req: Request, res: Response) => {
  const bookingId = req.params.bookingId as string;

  try {
    // Verify booking exists
    const booking = await queryOne<{
      id: string;
      clinic_id: string;
      patient_name: string;
      intake_completed: boolean;
    }>(
      `SELECT id, clinic_id, patient_name, intake_completed FROM bookings
       WHERE id = $1 AND status IN ('confirmed', 'completed')`,
      [bookingId]
    );

    if (!booking) {
      res.status(404).json({ error: "Booking not found" });
      return;
    }

    if (booking.intake_completed) {
      res.status(400).json({ error: "Intake form already submitted" });
      return;
    }

    // Validate required fields
    const data = req.body as IntakeFormData;
    if (!data.patientName || !data.consentHipaa || !data.consentTreatment) {
      res.status(400).json({
        error: "Required: patientName, consentHipaa, consentTreatment",
      });
      return;
    }

    const formId = await createIntakeForm(booking.clinic_id, bookingId, data);

    // Notify clinic via SMS
    const clinic = await queryOne<{ phone: string; name: string }>(
      `SELECT phone, name FROM clinics WHERE id = $1`,
      [booking.clinic_id]
    );

    if (clinic?.phone) {
      const { sendSms } = await import("../services/sms-service");
      await sendSms(
        clinic.phone,
        `${data.patientName} completed their intake form for their upcoming appointment. View it in your dashboard.`
      );
    }

    res.json({
      success: true,
      formId,
      message: "Intake form submitted successfully. Thank you!",
    });
  } catch (err: any) {
    logger.error("[INTAKE-API] Submit error:", err.message);
    res.status(500).json({ error: "Failed to submit intake form" });
  }
});

export default router;
