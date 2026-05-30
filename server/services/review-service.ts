/**
 * review-service.ts — Post-visit review collection (Group tier)
 *
 * Automatically sends review request SMS 2 hours after a completed appointment.
 * Tracks sent/clicked/reviewed status.
 */

import { query, queryOne, execute, isDbAvailable } from "../lib/db";
import { sendSms } from "./sms-service";
import { auditLog } from "./audit-service";
import logger from "../lib/logger";

interface ReviewEligibleBooking {
  id: string;
  clinic_id: string;
  patient_name: string;
  patient_phone: string;
  clinic_name: string;
  google_review_link: string | null;
  yelp_review_link: string | null;
}

/**
 * Find completed bookings eligible for review requests:
 * - status = 'completed'
 * - appointment ended 2+ hours ago
 * - review_requested = false
 * - patient has a phone number
 * - clinic has at least one review link configured
 */
async function findReviewEligible(): Promise<ReviewEligibleBooking[]> {
  return query<ReviewEligibleBooking>(
    `SELECT b.id, b.clinic_id, b.patient_name, b.patient_phone,
            c.name as clinic_name, c.google_review_link, c.yelp_review_link
     FROM bookings b
     JOIN clinics c ON b.clinic_id = c.id
     WHERE b.status = 'completed'
       AND b.review_requested = false
       AND b.patient_phone IS NOT NULL
       AND (b.appointment_date + b.start_time + (b.duration_minutes || ' minutes')::interval + INTERVAL '2 hours') < NOW()
       AND b.appointment_date >= CURRENT_DATE - INTERVAL '2 days'
       AND c.status = 'active'
       AND (c.google_review_link IS NOT NULL OR c.yelp_review_link IS NOT NULL)
       AND (c.features->>'review_collection_enabled')::boolean = true
     ORDER BY b.appointment_date DESC, b.start_time DESC
     LIMIT 50`
  );
}

/**
 * Send a review request SMS for a single booking.
 */
async function sendReviewRequest(booking: ReviewEligibleBooking): Promise<boolean> {
  let reviewLink = "";
  if (booking.google_review_link) {
    reviewLink = booking.google_review_link;
  } else if (booking.yelp_review_link) {
    reviewLink = booking.yelp_review_link;
  }

  const body =
    `Hi ${booking.patient_name}, thank you for visiting ${booking.clinic_name} today! ` +
    `If you had a great experience, we'd love a quick review: ${reviewLink} ` +
    `It helps other patients find us. Thank you!`;

  try {
    await sendSms(booking.patient_phone, body);

    // Mark booking as review requested
    await execute(
      `UPDATE bookings SET review_requested = true, review_sent_at = NOW() WHERE id = $1`,
      [booking.id]
    );

    // Record in review_requests table
    await execute(
      `INSERT INTO review_requests (clinic_id, booking_id, patient_name, patient_phone, channel, status, message_body)
       VALUES ($1, $2, $3, $4, 'sms', 'sent', $5)`,
      [booking.clinic_id, booking.id, booking.patient_name, booking.patient_phone, body]
    );

    await auditLog({
      clinicId: booking.clinic_id,
      userId: "system",
      action: "review.request_sent",
      resourceType: "booking",
      resourceId: booking.id,
      details: { patient_name: booking.patient_name },
    });

    return true;
  } catch (err: any) {
    logger.error(`[REVIEW] SMS failed for booking ${booking.id}:`, err.message);

    // Still mark as requested to avoid retrying failed sends
    await execute(
      `UPDATE bookings SET review_requested = true WHERE id = $1`,
      [booking.id]
    );

    await execute(
      `INSERT INTO review_requests (clinic_id, booking_id, patient_name, patient_phone, channel, status, message_body)
       VALUES ($1, $2, $3, $4, 'sms', 'failed', $5)`,
      [booking.clinic_id, booking.id, booking.patient_name, booking.patient_phone, err.message]
    );

    return false;
  }
}

/**
 * Run the review check — find eligible bookings and send review requests.
 */
async function runReviewCheck(): Promise<void> {
  if (!isDbAvailable()) return;

  try {
    const eligible = await findReviewEligible();
    if (eligible.length === 0) return;

    let sent = 0;
    for (const booking of eligible) {
      if (await sendReviewRequest(booking)) sent++;
    }

    if (sent > 0) {
      logger.info(`[REVIEW] Sent ${sent} review request SMS`);
    }
  } catch (err: any) {
    logger.error("[REVIEW] Scheduled check failed:", err.message);
  }
}

/**
 * Get review stats and history for a clinic (dashboard endpoint).
 */
export async function getReviewStats(
  clinicId: string,
  limit = 50,
  offset = 0
): Promise<{ reviews: any[]; total: number; stats: { sent: number; clicked: number; reviewed: number } }> {
  const [rows, countResult, statsResult] = await Promise.all([
    query(
      `SELECT * FROM review_requests
       WHERE clinic_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [clinicId, limit, offset]
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM review_requests WHERE clinic_id = $1`,
      [clinicId]
    ),
    query<{ status: string; count: string }>(
      `SELECT status, COUNT(*) as count FROM review_requests
       WHERE clinic_id = $1
       GROUP BY status`,
      [clinicId]
    ),
  ]);

  const statusMap: Record<string, number> = {};
  for (const row of statsResult) {
    statusMap[row.status] = parseInt(row.count, 10);
  }

  return {
    reviews: rows,
    total: parseInt(countResult?.count || "0", 10),
    stats: {
      sent: statusMap["sent"] || 0,
      clicked: statusMap["clicked"] || 0,
      reviewed: statusMap["reviewed"] || 0,
    },
  };
}

/**
 * Start the review collection scheduler. Runs every 15 minutes.
 */
let reviewInterval: ReturnType<typeof setInterval> | null = null;

export function startReviewScheduler(): void {
  if (!isDbAvailable()) {
    logger.info("[REVIEW] Skipped — no database available");
    return;
  }

  if (reviewInterval) {
    clearInterval(reviewInterval);
    reviewInterval = null;
  }

  const INTERVAL_MS = 15 * 60 * 1000;

  setTimeout(() => {
    runReviewCheck();
    reviewInterval = setInterval(runReviewCheck, INTERVAL_MS);
  }, 90_000);

  logger.info("[REVIEW] Scheduler started (every 15 min)");
}

export function stopReviewScheduler(): void {
  if (reviewInterval) {
    clearInterval(reviewInterval);
    reviewInterval = null;
    logger.info("[REVIEW] Scheduler stopped");
  }
}
