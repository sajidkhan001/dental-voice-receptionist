/**
 * call-service.ts — Call log CRUD operations
 */

import { query, queryOne, execute } from "../lib/db";
import { PipelineResult } from "../lib/types";
import { encryptField, decryptField } from "../lib/encryption";

export async function saveCallLog(clinicId: string, result: PipelineResult, callData: {
  transcript: string;
  caller_phone: string;
  recording_url?: string;
  duration_seconds?: number;
}): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO call_logs (
      clinic_id, call_id, transcript, caller_phone, recording_url, duration_seconds,
      intent, crisis_detected, crisis_reason,
      patient_name, patient_phone, patient_email, patient_insurance, is_new_patient,
      agent_response, actions, slots_offered, booking_confirmed, notifications_sent,
      pipeline_duration_ms, sentiment, call_summary, analysis_method,
      compliance_flags, tools_used, language_detected, escalation_details, quality_score
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
    ON CONFLICT (clinic_id, call_id) DO UPDATE SET
      transcript = EXCLUDED.transcript,
      intent = EXCLUDED.intent,
      crisis_detected = EXCLUDED.crisis_detected,
      agent_response = EXCLUDED.agent_response,
      actions = EXCLUDED.actions,
      slots_offered = EXCLUDED.slots_offered,
      booking_confirmed = EXCLUDED.booking_confirmed,
      notifications_sent = EXCLUDED.notifications_sent,
      pipeline_duration_ms = EXCLUDED.pipeline_duration_ms,
      sentiment = EXCLUDED.sentiment,
      call_summary = EXCLUDED.call_summary,
      analysis_method = EXCLUDED.analysis_method,
      compliance_flags = EXCLUDED.compliance_flags,
      tools_used = EXCLUDED.tools_used,
      language_detected = EXCLUDED.language_detected,
      escalation_details = EXCLUDED.escalation_details,
      quality_score = EXCLUDED.quality_score
    RETURNING id`,
    [
      clinicId,
      result.call_id,
      encryptField(callData.transcript),
      encryptField(callData.caller_phone),
      callData.recording_url || null,
      callData.duration_seconds || null,
      result.intent,
      result.crisis_detected,
      encryptField(result.crisis_reason),
      encryptField(result.patient_info?.name || null),
      encryptField(result.patient_info?.phone || null),
      encryptField(result.patient_info?.email || null),
      encryptField(result.patient_info?.insurance || null),
      result.patient_info?.is_new_patient || null,
      encryptField(result.agent_response),
      JSON.stringify(result.actions),
      JSON.stringify(result.slots_offered),
      result.booking_confirmed,
      JSON.stringify(result.notifications_sent),
      result.duration_ms,
      result.sentiment || null,
      result.call_summary || null,
      result.analysis_method || "regex",
      JSON.stringify(result.compliance_flags || []),
      JSON.stringify(result.tools_used || []),
      result.language_detected || "en",
      result.escalation_details ? JSON.stringify(result.escalation_details) : null,
      result.quality_score || null,
    ]
  );

  // Increment billing call counter
  try {
    const { incrementCallCount } = await import("./billing-service");
    await incrementCallCount(clinicId);
  } catch (err: any) {
    // Don't fail the call log save if billing tracking fails
    const { default: logger } = await import("../lib/logger");
    logger.warn(`[BILLING] Failed to increment call count: ${err.message}`);
  }

  return row!.id;
}

function decryptCallLog(row: any): any {
  if (!row) return row;
  return {
    ...row,
    transcript: decryptField(row.transcript),
    caller_phone: decryptField(row.caller_phone),
    patient_name: decryptField(row.patient_name),
    patient_phone: decryptField(row.patient_phone),
    patient_email: decryptField(row.patient_email),
    patient_insurance: decryptField(row.patient_insurance),
    crisis_reason: decryptField(row.crisis_reason),
    agent_response: decryptField(row.agent_response),
  };
}

export async function getCallLogs(clinicId: string, options: {
  limit?: number;
  offset?: number;
  intent?: string;
  dateFrom?: string;
  dateTo?: string;
} = {}): Promise<{ rows: any[]; total: number }> {
  const conditions = ["clinic_id = $1"];
  const params: any[] = [clinicId];
  let idx = 2;

  if (options.intent) {
    conditions.push(`intent = $${idx++}`);
    params.push(options.intent);
  }
  if (options.dateFrom) {
    conditions.push(`created_at >= $${idx++}`);
    params.push(options.dateFrom);
  }
  if (options.dateTo) {
    conditions.push(`created_at <= $${idx++}`);
    params.push(options.dateTo);
  }

  const where = conditions.join(" AND ");

  const [rows, countResult] = await Promise.all([
    query(
      `SELECT * FROM call_logs WHERE ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, options.limit || 50, options.offset || 0]
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM call_logs WHERE ${where}`,
      params
    ),
  ]);

  return { rows: rows.map(decryptCallLog), total: parseInt(countResult?.count || "0", 10) };
}

export async function updateCallRecordingUrl(callId: string, recordingUrl: string): Promise<void> {
  await execute(
    `UPDATE call_logs SET recording_url = $1 WHERE call_id = $2`,
    [recordingUrl, callId]
  );
}

export async function getCallLog(clinicId: string, callLogId: string): Promise<any | null> {
  const row = await queryOne(
    `SELECT * FROM call_logs WHERE clinic_id = $1 AND id = $2`,
    [clinicId, callLogId]
  );
  return decryptCallLog(row);
}

export async function getKpis(clinicId: string): Promise<{
  totalCalls: number;
  todayCalls: number;
  bookingRate: number;
  crisisCount: number;
  avgDurationMs: number;
}> {
  const result = await queryOne<any>(
    `SELECT
      COUNT(*) as total_calls,
      COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) as today_calls,
      ROUND(100.0 * COUNT(*) FILTER (WHERE booking_confirmed = true) / NULLIF(COUNT(*), 0), 1) as booking_rate,
      COUNT(*) FILTER (WHERE crisis_detected = true) as crisis_count,
      ROUND(AVG(pipeline_duration_ms)) as avg_duration_ms
    FROM call_logs WHERE clinic_id = $1`,
    [clinicId]
  );

  return {
    totalCalls: parseInt(result?.total_calls || "0", 10),
    todayCalls: parseInt(result?.today_calls || "0", 10),
    bookingRate: parseFloat(result?.booking_rate || "0"),
    crisisCount: parseInt(result?.crisis_count || "0", 10),
    avgDurationMs: parseInt(result?.avg_duration_ms || "0", 10),
  };
}

export async function getAnalytics(clinicId: string, days: number = 30): Promise<{
  intentDistribution: { intent: string; count: number }[];
  dailyCallVolume: { date: string; count: number }[];
  dailyBookingRate: { date: string; rate: number }[];
}> {
  const [intents, volume, bookings] = await Promise.all([
    query<{ intent: string; count: string }>(
      `SELECT intent, COUNT(*) as count FROM call_logs
       WHERE clinic_id = $1 AND created_at >= NOW() - INTERVAL '1 day' * $2
       GROUP BY intent ORDER BY count DESC`,
      [clinicId, days]
    ),
    query<{ date: string; count: string }>(
      `SELECT created_at::date as date, COUNT(*) as count FROM call_logs
       WHERE clinic_id = $1 AND created_at >= NOW() - INTERVAL '1 day' * $2
       GROUP BY date ORDER BY date`,
      [clinicId, days]
    ),
    query<{ date: string; rate: string }>(
      `SELECT created_at::date as date,
        ROUND(100.0 * COUNT(*) FILTER (WHERE booking_confirmed) / NULLIF(COUNT(*), 0), 1) as rate
       FROM call_logs
       WHERE clinic_id = $1 AND created_at >= NOW() - INTERVAL '1 day' * $2
       GROUP BY date ORDER BY date`,
      [clinicId, days]
    ),
  ]);

  return {
    intentDistribution: intents.map((r) => ({ intent: r.intent, count: parseInt(r.count, 10) })),
    dailyCallVolume: volume.map((r) => ({ date: r.date, count: parseInt(r.count, 10) })),
    dailyBookingRate: bookings.map((r) => ({ date: r.date, rate: parseFloat(r.rate) })),
  };
}
