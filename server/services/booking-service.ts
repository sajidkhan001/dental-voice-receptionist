/**
 * booking-service.ts — Booking CRUD operations
 */

import { query, queryOne, execute, withTransaction } from "../lib/db";

export async function createBooking(clinicId: string, data: {
  callLogId?: string;
  googleEventId?: string;
  providerId?: string;
  serviceId?: string;
  patientName: string;
  patientPhone?: string;
  patientEmail?: string;
  patientInsurance?: string;
  isNewPatient?: boolean;
  appointmentDate: string;
  startTime: string;
  durationMinutes: number;
}): Promise<string> {
  return withTransaction(async (client) => {
    // Acquire advisory lock to prevent race conditions on the same slot
    const lockKey = BigInt(Date.now()) % BigInt(2147483647);
    await client.query("SELECT pg_advisory_lock($1)", [lockKey]);

    try {
      // Check for conflicting booking (same provider, date, overlapping time)
      if (data.providerId) {
        const conflict = await client.query(
          `SELECT id FROM bookings
           WHERE clinic_id = $1 AND provider_id = $2
             AND appointment_date = $3
             AND status IN ('confirmed', 'completed')
             AND (start_time, (start_time + (duration_minutes || ' minutes')::interval))
             OVERLAPS ($4::time, ($4::time + ($5 || ' minutes')::interval))`,
          [clinicId, data.providerId, data.appointmentDate, data.startTime, data.durationMinutes]
        );
        if (conflict.rows.length > 0) {
          throw new Error("Time slot already booked");
        }
      }

      const result = await client.query<{ id: string }>(
        `INSERT INTO bookings (
          clinic_id, call_log_id, google_event_id, provider_id, service_id,
          patient_name, patient_phone, patient_email, patient_insurance, is_new_patient,
          appointment_date, start_time, duration_minutes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        RETURNING id`,
        [
          clinicId,
          data.callLogId || null,
          data.googleEventId || null,
          data.providerId || null,
          data.serviceId || null,
          data.patientName,
          data.patientPhone || null,
          data.patientEmail || null,
          data.patientInsurance || null,
          data.isNewPatient || false,
          data.appointmentDate,
          data.startTime,
          data.durationMinutes,
        ]
      );
      return result.rows[0].id;
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [lockKey]);
    }
  });
}

export async function getBookings(clinicId: string, options: {
  month?: string;  // "2026-03"
  status?: string;
  providerId?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ rows: any[]; total: number }> {
  const conditions = ["b.clinic_id = $1"];
  const params: any[] = [clinicId];
  let idx = 2;

  if (options.month) {
    conditions.push(`TO_CHAR(b.appointment_date, 'YYYY-MM') = $${idx++}`);
    params.push(options.month);
  }
  if (options.status) {
    conditions.push(`b.status = $${idx++}`);
    params.push(options.status);
  }
  if (options.providerId) {
    conditions.push(`b.provider_id = $${idx++}`);
    params.push(options.providerId);
  }

  const where = conditions.join(" AND ");

  const [rows, countResult] = await Promise.all([
    query(
      `SELECT b.*, p.name as provider_name, s.name as service_name
       FROM bookings b
       LEFT JOIN providers p ON b.provider_id = p.id
       LEFT JOIN services s ON b.service_id = s.id
       WHERE ${where}
       ORDER BY b.appointment_date DESC, b.start_time DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, options.limit || 50, options.offset || 0]
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM bookings b WHERE ${where}`,
      params
    ),
  ]);

  return { rows, total: parseInt(countResult?.count || "0", 10) };
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  confirmed: ["cancelled", "completed", "no_show", "rescheduled"],
  no_show: ["rescheduled"],
  cancelled: [],
  completed: [],
  rescheduled: ["confirmed", "cancelled"],
};

export async function updateBookingStatus(clinicId: string, bookingId: string, newStatus: string): Promise<void> {
  const booking = await queryOne<{ status: string }>(
    `SELECT status FROM bookings WHERE clinic_id = $1 AND id = $2`,
    [clinicId, bookingId]
  );
  if (!booking) throw new Error("Booking not found");

  const allowed = VALID_TRANSITIONS[booking.status] || [];
  if (!allowed.includes(newStatus)) {
    throw new Error(`Invalid status transition: ${booking.status} → ${newStatus}`);
  }

  await execute(
    `UPDATE bookings SET status = $1, updated_at = NOW() WHERE clinic_id = $2 AND id = $3`,
    [newStatus, clinicId, bookingId]
  );
}

export async function getMonthlyAppointments(clinicId: string, month: string): Promise<any[]> {
  return query(
    `SELECT b.*, p.name as provider_name, s.name as service_name
     FROM bookings b
     LEFT JOIN providers p ON b.provider_id = p.id
     LEFT JOIN services s ON b.service_id = s.id
     WHERE b.clinic_id = $1 AND TO_CHAR(b.appointment_date, 'YYYY-MM') = $2
     ORDER BY b.appointment_date, b.start_time`,
    [clinicId, month]
  );
}

/**
 * Get today's appointments for the clinic dashboard "Today" tab
 */
export async function getTodaysAppointments(clinicId: string): Promise<any[]> {
  return query(
    `SELECT b.id, b.patient_name, b.patient_phone, b.appointment_date,
            b.start_time, b.duration_minutes, b.status, b.is_new_patient,
            p.name as provider_name, s.name as service_name,
            (SELECT COUNT(*) FROM noshow_followups nf WHERE nf.booking_id = b.id) as followup_count
     FROM bookings b
     LEFT JOIN providers p ON b.provider_id = p.id
     LEFT JOIN services s ON b.service_id = s.id
     WHERE b.clinic_id = $1 AND b.appointment_date = CURRENT_DATE
     ORDER BY b.start_time`,
    [clinicId]
  );
}

/**
 * Get no-show stats for the dashboard KPI cards
 */
export async function getNoShowStats(clinicId: string): Promise<{
  today_total: number;
  today_arrived: number;
  today_noshow: number;
  today_pending: number;
  week_noshow: number;
  pending_followups: number;
}> {
  const [todayStats, weekNoShow, pendingFollowups] = await Promise.all([
    query<{ status: string; count: string }>(
      `SELECT status, COUNT(*) as count
       FROM bookings
       WHERE clinic_id = $1 AND appointment_date = CURRENT_DATE
       GROUP BY status`,
      [clinicId]
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM bookings
       WHERE clinic_id = $1
         AND status = 'no_show'
         AND appointment_date >= CURRENT_DATE - INTERVAL '7 days'`,
      [clinicId]
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM bookings b
       WHERE b.clinic_id = $1
         AND b.status = 'no_show'
         AND b.appointment_date >= CURRENT_DATE - INTERVAL '1 day'
         AND b.patient_phone IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM noshow_followups nf
           WHERE nf.booking_id = b.id
         )`,
      [clinicId]
    ),
  ]);

  const statusMap: Record<string, number> = {};
  let total = 0;
  for (const row of todayStats) {
    const c = parseInt(row.count, 10);
    statusMap[row.status] = c;
    total += c;
  }

  return {
    today_total: total,
    today_arrived: statusMap["completed"] || 0,
    today_noshow: statusMap["no_show"] || 0,
    today_pending: statusMap["confirmed"] || 0,
    week_noshow: parseInt(weekNoShow?.count || "0", 10),
    pending_followups: parseInt(pendingFollowups?.count || "0", 10),
  };
}
