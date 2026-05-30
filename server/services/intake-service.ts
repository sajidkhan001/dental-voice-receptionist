/**
 * intake-service.ts — Digital patient intake form management
 *
 * Handles patient intake form CRUD, auto-sends intake links after booking,
 * and provides dashboard views for submitted forms.
 */

import { query, queryOne, execute, isDbAvailable } from "../lib/db";
import { sendSms } from "./sms-service";
import { sendEmail } from "./email-service";
import { auditLog } from "./audit-service";
import logger from "../lib/logger";

function xmlEncode(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface IntakeFormData {
  patientName: string;
  patientDob?: string;
  patientPhone?: string;
  patientEmail?: string;
  patientAddress?: string;
  medicalHistory?: {
    conditions?: string[];
    surgeries?: string[];
    hospitalizations?: string;
    pregnant?: boolean;
    nursing?: boolean;
    bloodDisorders?: boolean;
    heartCondition?: boolean;
    diabetes?: boolean;
    highBloodPressure?: boolean;
    hepatitis?: boolean;
    hiv?: boolean;
    asthma?: boolean;
    seizures?: boolean;
    other?: string;
  };
  currentMedications?: string;
  allergies?: string;
  dentalHistory?: {
    lastDentalVisit?: string;
    previousDentist?: string;
    reasonForVisit?: string;
    dentalAnxiety?: boolean;
    gumBleeding?: boolean;
    jawPain?: boolean;
    grindTeeth?: boolean;
    orthodonticHistory?: boolean;
    oralSurgeryHistory?: boolean;
    sensitiveTeeth?: boolean;
    other?: string;
  };
  lastDentalVisit?: string;
  reasonForVisit?: string;
  painLevel?: number;
  insuranceCarrier?: string;
  insuranceMemberId?: string;
  insuranceGroupNumber?: string;
  insurancePhone?: string;
  consentHipaa: boolean;
  consentTreatment: boolean;
  consentFinancial?: boolean;
  signatureData?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
}

/**
 * Create a new intake form (linked to a booking).
 */
export async function createIntakeForm(
  clinicId: string,
  bookingId: string | null,
  data: IntakeFormData
): Promise<string> {
  const result = await queryOne<{ id: string }>(
    `INSERT INTO patient_intake_forms (
      clinic_id, booking_id, patient_name, patient_dob, patient_phone, patient_email,
      patient_address, medical_history, current_medications, allergies,
      dental_history, last_dental_visit, reason_for_visit, pain_level,
      insurance_carrier, insurance_member_id, insurance_group_number, insurance_phone,
      consent_hipaa, consent_treatment, consent_financial, signature_data, signed_at,
      emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
      status, submitted_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
      $15, $16, $17, $18, $19, $20, $21, $22, NOW(), $23, $24, $25,
      'submitted', NOW()
    ) RETURNING id`,
    [
      clinicId,
      bookingId,
      data.patientName,
      data.patientDob || null,
      data.patientPhone || null,
      data.patientEmail || null,
      data.patientAddress || null,
      JSON.stringify(data.medicalHistory || {}),
      data.currentMedications || null,
      data.allergies || null,
      JSON.stringify(data.dentalHistory || {}),
      data.lastDentalVisit || null,
      data.reasonForVisit || null,
      data.painLevel ?? null,
      data.insuranceCarrier || null,
      data.insuranceMemberId || null,
      data.insuranceGroupNumber || null,
      data.insurancePhone || null,
      data.consentHipaa,
      data.consentTreatment,
      data.consentFinancial || false,
      data.signatureData || null,
      data.emergencyContactName || null,
      data.emergencyContactPhone || null,
      data.emergencyContactRelation || null,
    ]
  );

  const formId = result!.id;

  // Link intake form to booking
  if (bookingId) {
    await execute(
      `UPDATE bookings SET intake_completed = true, intake_form_id = $1, updated_at = NOW() WHERE id = $2`,
      [formId, bookingId]
    );
  }

  await auditLog({
    clinicId,
    userId: "patient",
    action: "intake.form_submitted",
    resourceType: "patient_intake_form",
    resourceId: formId,
    details: { patient_name: data.patientName, booking_id: bookingId },
  });

  logger.info(`[INTAKE] Form submitted: ${formId} for ${data.patientName}`);
  return formId;
}

/**
 * Get intake forms for a clinic (dashboard view).
 */
export async function getIntakeForms(
  clinicId: string,
  options: { status?: string; limit?: number; offset?: number; dateFrom?: string; dateTo?: string } = {}
): Promise<{ forms: any[]; total: number }> {
  const conditions = ["pif.clinic_id = $1"];
  const params: any[] = [clinicId];
  let idx = 2;

  if (options.status) {
    conditions.push(`pif.status = $${idx++}`);
    params.push(options.status);
  }
  if (options.dateFrom) {
    conditions.push(`pif.submitted_at >= $${idx++}::date`);
    params.push(options.dateFrom);
  }
  if (options.dateTo) {
    conditions.push(`pif.submitted_at <= ($${idx++}::date + INTERVAL '1 day')`);
    params.push(options.dateTo);
  }

  const where = conditions.join(" AND ");
  const limit = options.limit || 50;
  const offset = options.offset || 0;

  const [rows, countResult] = await Promise.all([
    query(
      `SELECT pif.*, b.appointment_date, b.start_time, b.provider_id,
              p.name as provider_name, s.name as service_name
       FROM patient_intake_forms pif
       LEFT JOIN bookings b ON pif.booking_id = b.id
       LEFT JOIN providers p ON b.provider_id = p.id
       LEFT JOIN services s ON b.service_id = s.id
       WHERE ${where}
       ORDER BY pif.submitted_at DESC NULLS LAST, pif.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM patient_intake_forms pif WHERE ${where}`,
      params
    ),
  ]);

  return { forms: rows, total: parseInt(countResult?.count || "0", 10) };
}

/**
 * Get a single intake form by ID.
 */
export async function getIntakeFormById(clinicId: string, formId: string): Promise<any | null> {
  return queryOne(
    `SELECT pif.*, b.appointment_date, b.start_time,
            p.name as provider_name, s.name as service_name
     FROM patient_intake_forms pif
     LEFT JOIN bookings b ON pif.booking_id = b.id
     LEFT JOIN providers p ON b.provider_id = p.id
     LEFT JOIN services s ON b.service_id = s.id
     WHERE pif.id = $1 AND pif.clinic_id = $2`,
    [formId, clinicId]
  );
}

/**
 * Mark intake form as reviewed.
 */
export async function reviewIntakeForm(clinicId: string, formId: string, reviewedBy: string): Promise<void> {
  await execute(
    `UPDATE patient_intake_forms SET status = 'reviewed', reviewed_by = $1, reviewed_at = NOW(), updated_at = NOW()
     WHERE id = $2 AND clinic_id = $3`,
    [reviewedBy, formId, clinicId]
  );
}

/**
 * Send intake form link via SMS and email after booking.
 */
export async function sendIntakeLink(
  clinicId: string,
  bookingId: string,
  patientName: string,
  patientPhone: string | null,
  patientEmail: string | null,
  baseUrl: string
): Promise<void> {
  const intakeUrl = `${baseUrl}/intake/${bookingId}`;

  const clinic = await queryOne<{ name: string }>(
    `SELECT name FROM clinics WHERE id = $1`,
    [clinicId]
  );
  const clinicName = clinic?.name || "our dental office";

  if (patientPhone) {
    await sendSms(
      patientPhone,
      `Hi ${patientName}! Please complete your intake form before your visit to ${clinicName}: ${intakeUrl} It takes about 5 minutes and helps us prepare for your appointment.`
    );
  }

  if (patientEmail) {
    await sendEmail({
      to: patientEmail,
      subject: `Complete Your Intake Form — ${clinicName}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #1a1a1a; margin-bottom: 8px;">Welcome, ${xmlEncode(patientName)}!</h2>
          <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6;">
            Thank you for scheduling your appointment with ${xmlEncode(clinicName)}. To save time during your visit, please complete your intake form online.
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${xmlEncode(intakeUrl)}" style="background-color: #2563EB; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: 600; display: inline-block;">
              Complete Intake Form
            </a>
          </div>
          <p style="color: #6b6b6b; font-size: 14px;">
            The form takes about 5 minutes and includes your medical history, dental history, and insurance information.
          </p>
          <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
          <p style="color: #9b9b9b; font-size: 12px;">
            ${xmlEncode(clinicName)} | This is an automated message. Please do not reply.
          </p>
        </div>
      `,
    });
  }

  logger.info(`[INTAKE] Link sent to ${patientName} (phone: ${!!patientPhone}, email: ${!!patientEmail})`);
}

/**
 * Get intake form stats for dashboard KPIs.
 */
export async function getIntakeStats(clinicId: string): Promise<{
  total: number;
  pending: number;
  submitted: number;
  reviewed: number;
}> {
  const stats = await query<{ status: string; count: string }>(
    `SELECT status, COUNT(*) as count FROM patient_intake_forms
     WHERE clinic_id = $1 GROUP BY status`,
    [clinicId]
  );

  const map: Record<string, number> = {};
  let total = 0;
  for (const row of stats) {
    const c = parseInt(row.count, 10);
    map[row.status] = c;
    total += c;
  }

  return {
    total,
    pending: map["pending"] || 0,
    submitted: map["submitted"] || 0,
    reviewed: map["reviewed"] || 0,
  };
}
