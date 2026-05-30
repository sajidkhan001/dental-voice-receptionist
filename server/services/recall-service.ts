/**
 * recall-service.ts — Patient recall & reactivation (Group tier)
 *
 * Finds patients who haven't visited in 6+ months and sends
 * SMS or triggers AI outbound calls to re-engage them.
 *
 * Scheduler pattern matches reminder-service.ts / noshow-service.ts.
 */

import { query, queryOne, execute, isDbAvailable } from "../lib/db";
import { sendSms } from "./sms-service";
import { auditLog } from "./audit-service";
import logger from "../lib/logger";

interface RecallCandidate {
  patient_name: string;
  patient_phone: string;
  patient_email: string | null;
  last_visit_date: string;
  last_service: string | null;
  clinic_id: string;
  clinic_name: string;
  clinic_phone: string | null;
}

/**
 * Find patients eligible for recall: last completed visit 6+ months ago,
 * have a phone number, and haven't been contacted for recall in the last 30 days.
 */
export async function findRecallCandidates(clinicId: string): Promise<RecallCandidate[]> {
  if (!isDbAvailable()) return [];

  return query<RecallCandidate>(
    `SELECT DISTINCT ON (b.patient_phone)
            b.patient_name, b.patient_phone, b.patient_email,
            b.appointment_date as last_visit_date,
            s.name as last_service,
            c.id as clinic_id, c.name as clinic_name, c.phone as clinic_phone
     FROM bookings b
     JOIN clinics c ON b.clinic_id = c.id
     LEFT JOIN services s ON b.service_id = s.id
     WHERE b.clinic_id = $1
       AND b.status = 'completed'
       AND b.patient_phone IS NOT NULL
       AND b.appointment_date <= CURRENT_DATE - INTERVAL '6 months'
       AND NOT EXISTS (
         SELECT 1 FROM recall_campaigns rc
         WHERE rc.clinic_id = $1
           AND rc.patient_phone = b.patient_phone
           AND rc.created_at >= CURRENT_DATE - INTERVAL '30 days'
       )
       AND NOT EXISTS (
         SELECT 1 FROM bookings future
         WHERE future.clinic_id = $1
           AND future.patient_phone = b.patient_phone
           AND future.appointment_date > b.appointment_date
           AND future.status IN ('confirmed', 'completed')
       )
     ORDER BY b.patient_phone, b.appointment_date DESC
     LIMIT 100`,
    [clinicId]
  );
}

/**
 * Send a recall SMS to a single patient.
 */
export async function sendRecallSms(
  clinicId: string,
  candidate: RecallCandidate
): Promise<{ success: boolean; message: string }> {
  const body =
    `Hi ${candidate.patient_name}, it's been a while since your last visit to ${candidate.clinic_name}. ` +
    `We'd love to see you! Reply BOOK to schedule or call us at ${candidate.clinic_phone || "our office"}. ` +
    `We look forward to helping you keep your smile healthy!`;

  try {
    await sendSms(candidate.patient_phone, body);

    await execute(
      `INSERT INTO recall_campaigns (clinic_id, patient_name, patient_phone, patient_email, last_visit_date, last_service, channel, status, message_body)
       VALUES ($1, $2, $3, $4, $5, $6, 'sms', 'sent', $7)`,
      [
        clinicId,
        candidate.patient_name,
        candidate.patient_phone,
        candidate.patient_email,
        candidate.last_visit_date,
        candidate.last_service,
        body,
      ]
    );

    await auditLog({
      clinicId,
      userId: "system",
      action: "recall.sms_sent",
      details: { patient_name: candidate.patient_name, patient_phone: candidate.patient_phone },
    });

    return { success: true, message: `Recall SMS sent to ${candidate.patient_phone}` };
  } catch (err: any) {
    logger.error(`[RECALL] SMS failed for ${candidate.patient_phone}:`, err.message);

    await execute(
      `INSERT INTO recall_campaigns (clinic_id, patient_name, patient_phone, channel, status, notes)
       VALUES ($1, $2, $3, 'sms', 'failed', $4)`,
      [clinicId, candidate.patient_name, candidate.patient_phone, err.message]
    );

    return { success: false, message: `SMS failed: ${err.message}` };
  }
}

/**
 * Trigger an AI outbound call for patient recall.
 */
export async function triggerRecallCall(
  clinicId: string,
  candidate: RecallCandidate,
  userId: string
): Promise<{ success: boolean; message: string }> {
  const callDetails = {
    patient_name: candidate.patient_name,
    patient_phone: candidate.patient_phone,
    last_visit_date: candidate.last_visit_date,
    last_service: candidate.last_service,
    clinic_name: candidate.clinic_name,
  };

  // Simulation mode
  if (process.env.SIMULATION_MODE !== "false" || !process.env.TELNYX_API_KEY) {
    logger.info(`[RECALL] AI call simulation for ${candidate.patient_name}: ${candidate.patient_phone}`);

    await execute(
      `INSERT INTO recall_campaigns (clinic_id, patient_name, patient_phone, patient_email, last_visit_date, last_service, channel, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, 'ai_call', 'sent', $7)`,
      [
        clinicId,
        candidate.patient_name,
        candidate.patient_phone,
        candidate.patient_email,
        candidate.last_visit_date,
        candidate.last_service,
        JSON.stringify({ mode: "simulation", ...callDetails }),
      ]
    );

    await auditLog({
      clinicId,
      userId,
      action: "recall.ai_call",
      details: { ...callDetails, mode: "simulation" },
    });

    return { success: true, message: `AI recall call queued (simulation) for ${candidate.patient_phone}` };
  }

  // Production: Telnyx outbound call
  try {
    const Telnyx = (await import("telnyx")).default;
    const telnyx = new Telnyx({ apiKey: process.env.TELNYX_API_KEY! });

    const clinic = await queryOne<{ telnyx_phone_number: string }>(
      `SELECT telnyx_phone_number FROM clinics WHERE id = $1`,
      [clinicId]
    );

    if (!clinic?.telnyx_phone_number) {
      return { success: false, message: "Clinic has no phone number configured" };
    }

    const baseUrl = process.env.BASE_URL || "https://localhost:3001";
    const call = await telnyx.calls.dial({
      to: candidate.patient_phone,
      from: clinic.telnyx_phone_number,
      connection_id: process.env.TELNYX_CONNECTION_ID!,
      webhook_url: `${baseUrl}/webhook/voice`,
    });

    const callId = call.data?.call_control_id || `telnyx-${Date.now()}`;

    await execute(
      `INSERT INTO recall_campaigns (clinic_id, patient_name, patient_phone, patient_email, last_visit_date, last_service, channel, status, call_sid, notes)
       VALUES ($1, $2, $3, $4, $5, $6, 'ai_call', 'sent', $7, $8)`,
      [
        clinicId,
        candidate.patient_name,
        candidate.patient_phone,
        candidate.patient_email,
        candidate.last_visit_date,
        candidate.last_service,
        callId,
        JSON.stringify(callDetails),
      ]
    );

    await auditLog({
      clinicId,
      userId,
      action: "recall.ai_call",
      details: { ...callDetails, call_id: callId },
    });

    return { success: true, message: `AI calling ${candidate.patient_phone} (ID: ${callId})` };
  } catch (err: any) {
    logger.error(`[RECALL] AI call failed for ${candidate.patient_phone}:`, err.message);

    await execute(
      `INSERT INTO recall_campaigns (clinic_id, patient_name, patient_phone, channel, status, notes)
       VALUES ($1, $2, $3, 'ai_call', 'failed', $4)`,
      [clinicId, candidate.patient_name, candidate.patient_phone, err.message]
    );

    return { success: false, message: `AI call failed: ${err.message}` };
  }
}

/**
 * Get recall campaign history for a clinic.
 */
export async function getRecallHistory(
  clinicId: string,
  limit = 50,
  offset = 0
): Promise<{ rows: any[]; total: number }> {
  const [rows, countResult] = await Promise.all([
    query(
      `SELECT * FROM recall_campaigns
       WHERE clinic_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [clinicId, limit, offset]
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM recall_campaigns WHERE clinic_id = $1`,
      [clinicId]
    ),
  ]);

  return { rows, total: parseInt(countResult?.count || "0", 10) };
}

/**
 * Automated daily recall check — sends SMS to eligible patients.
 * Only runs for clinics with recall enabled in their features config.
 */
async function runRecallCheck(): Promise<void> {
  try {
    // Find clinics with recall enabled
    const clinics = await query<{ id: string; name: string }>(
      `SELECT id, name FROM clinics
       WHERE status = 'active'
         AND (features->>'recall_enabled')::boolean = true`
    );

    for (const clinic of clinics) {
      const candidates = await findRecallCandidates(clinic.id);
      if (candidates.length === 0) continue;

      // Send SMS to up to 10 patients per clinic per day
      const batch = candidates.slice(0, 10);
      let sent = 0;
      for (const candidate of batch) {
        const result = await sendRecallSms(clinic.id, candidate);
        if (result.success) sent++;
      }

      if (sent > 0) {
        logger.info(`[RECALL] Sent ${sent} recall SMS for ${clinic.name}`);
      }
    }
  } catch (err: any) {
    logger.error("[RECALL] Scheduled check failed:", err.message);
  }
}

/**
 * Start the recall scheduler. Runs once per day.
 */
let recallInterval: ReturnType<typeof setInterval> | null = null;

export function startRecallScheduler(): void {
  if (!isDbAvailable()) {
    logger.info("[RECALL] Skipped — no database available");
    return;
  }

  if (recallInterval) {
    clearInterval(recallInterval);
    recallInterval = null;
  }

  const DAILY_MS = 24 * 60 * 60 * 1000;

  setTimeout(() => {
    runRecallCheck();
    recallInterval = setInterval(runRecallCheck, DAILY_MS);
  }, 120_000);

  logger.info("[RECALL] Scheduler started (daily)");
}

export function stopRecallScheduler(): void {
  if (recallInterval) {
    clearInterval(recallInterval);
    recallInterval = null;
    logger.info("[RECALL] Scheduler stopped");
  }
}
