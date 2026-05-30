/**
 * performance-service.ts — Daily performance metrics reporter
 *
 * Runs daily at midnight. Queries call_logs, bookings, escalations
 * and compares against CLAUDE.md targets. Logs report and saves to DB.
 *
 * CLAUDE.md Targets:
 *  - 95% of calls answered within 3 rings
 *  - <5% no-show rate
 *  - 30% new patient booking rate
 *  - 100% crisis escalation within 30s
 *  - <2% booking error rate
 *  - Patient satisfaction: 4.5/5.0+
 */

import { query, queryOne, execute, isDbAvailable } from "../lib/db";
import logger from "../lib/logger";

interface DailyReport {
  clinic_id: string;
  clinic_name: string;
  report_date: string;
  total_calls: number;
  total_bookings: number;
  booking_rate: number;
  crisis_calls: number;
  crisis_escalated: number;
  escalation_rate: number;
  avg_call_duration_sec: number;
  avg_pipeline_ms: number;
  no_show_count: number;
  no_show_rate: number;
  intent_distribution: Record<string, number>;
  sentiment_distribution: Record<string, number>;
  targets_met: string[];
  targets_missed: string[];
}

const TARGETS = {
  bookingRate: 30,           // 30% of calls result in booking
  noShowRate: 5,             // <5% no-show rate
  crisisEscalationRate: 100, // 100% of crises escalated
  maxPipelineMs: 2000,       // <2s pipeline latency
};

/**
 * Generate daily performance report for all active clinics.
 */
export async function generateDailyReport(): Promise<void> {
  if (!isDbAvailable()) return;

  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const reportDate = yesterday.toISOString().split("T")[0];

    // Get all active clinics
    const clinics = await query<{ id: string; name: string }>(
      `SELECT id, name FROM clinics WHERE status = 'active'`
    );

    if (clinics.length === 0) {
      logger.info("[PERFORMANCE] No active clinics — skipping report");
      return;
    }

    for (const clinic of clinics) {
      await generateClinicReport(clinic.id, clinic.name, reportDate);
    }

    logger.info(`[PERFORMANCE] Daily reports generated for ${clinics.length} clinics (${reportDate})`);
  } catch (err: any) {
    logger.error("[PERFORMANCE] Report generation failed:", err.message);
  }
}

async function generateClinicReport(clinicId: string, clinicName: string, reportDate: string): Promise<void> {
  // Call metrics
  const callStats = await queryOne<{
    total: string;
    bookings: string;
    crises: string;
    avg_duration: string;
    avg_pipeline: string;
  }>(
    `SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE booking_confirmed = true) as bookings,
      COUNT(*) FILTER (WHERE crisis_detected = true) as crises,
      ROUND(AVG(duration_seconds)) as avg_duration,
      ROUND(AVG(pipeline_duration_ms)) as avg_pipeline
    FROM call_logs
    WHERE clinic_id = $1 AND created_at::date = $2`,
    [clinicId, reportDate]
  );

  const totalCalls = parseInt(callStats?.total || "0", 10);

  if (totalCalls === 0) {
    logger.debug(`[PERFORMANCE] ${clinicName}: No calls on ${reportDate}`);
    return;
  }

  const totalBookings = parseInt(callStats?.bookings || "0", 10);
  const crisisCalls = parseInt(callStats?.crises || "0", 10);
  const avgDuration = parseInt(callStats?.avg_duration || "0", 10);
  const avgPipeline = parseInt(callStats?.avg_pipeline || "0", 10);

  // Intent distribution
  const intents = await query<{ intent: string; count: string }>(
    `SELECT intent, COUNT(*) as count FROM call_logs
     WHERE clinic_id = $1 AND created_at::date = $2
     GROUP BY intent ORDER BY count DESC`,
    [clinicId, reportDate]
  );
  const intentDistribution: Record<string, number> = {};
  for (const row of intents) {
    intentDistribution[row.intent] = parseInt(row.count, 10);
  }

  // Sentiment distribution
  const sentiments = await query<{ sentiment: string; count: string }>(
    `SELECT COALESCE(sentiment, 'unknown') as sentiment, COUNT(*) as count FROM call_logs
     WHERE clinic_id = $1 AND created_at::date = $2
     GROUP BY sentiment ORDER BY count DESC`,
    [clinicId, reportDate]
  );
  const sentimentDistribution: Record<string, number> = {};
  for (const row of sentiments) {
    sentimentDistribution[row.sentiment] = parseInt(row.count, 10);
  }

  // No-show rate (from bookings on that date)
  const noShowStats = await queryOne<{ total: string; no_shows: string }>(
    `SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'no_show') as no_shows
    FROM bookings
    WHERE clinic_id = $1 AND appointment_date = $2`,
    [clinicId, reportDate]
  );
  const totalAppts = parseInt(noShowStats?.total || "0", 10);
  const noShowCount = parseInt(noShowStats?.no_shows || "0", 10);
  const noShowRate = totalAppts > 0 ? (noShowCount / totalAppts) * 100 : 0;

  // Escalation check (all crises should have been escalated)
  const escalationCount = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM escalations
     WHERE clinic_id = $1 AND created_at::date = $2`,
    [clinicId, reportDate]
  );
  const crisisEscalated = parseInt(escalationCount?.count || "0", 10);

  // Calculate rates
  const bookingRate = totalCalls > 0 ? (totalBookings / totalCalls) * 100 : 0;
  const escalationRate = crisisCalls > 0 ? (crisisEscalated / crisisCalls) * 100 : 100;

  // Check targets
  const targetsMet: string[] = [];
  const targetsMissed: string[] = [];

  if (bookingRate >= TARGETS.bookingRate) {
    targetsMet.push(`Booking rate: ${bookingRate.toFixed(1)}% (target: ${TARGETS.bookingRate}%)`);
  } else {
    targetsMissed.push(`Booking rate: ${bookingRate.toFixed(1)}% (target: ${TARGETS.bookingRate}%)`);
  }

  if (noShowRate <= TARGETS.noShowRate) {
    targetsMet.push(`No-show rate: ${noShowRate.toFixed(1)}% (target: <${TARGETS.noShowRate}%)`);
  } else {
    targetsMissed.push(`No-show rate: ${noShowRate.toFixed(1)}% (target: <${TARGETS.noShowRate}%)`);
  }

  if (escalationRate >= TARGETS.crisisEscalationRate) {
    targetsMet.push(`Crisis escalation: ${escalationRate.toFixed(0)}% (target: ${TARGETS.crisisEscalationRate}%)`);
  } else {
    targetsMissed.push(`Crisis escalation: ${escalationRate.toFixed(0)}% (target: ${TARGETS.crisisEscalationRate}%)`);
  }

  if (avgPipeline <= TARGETS.maxPipelineMs) {
    targetsMet.push(`Avg pipeline: ${avgPipeline}ms (target: <${TARGETS.maxPipelineMs}ms)`);
  } else {
    targetsMissed.push(`Avg pipeline: ${avgPipeline}ms (target: <${TARGETS.maxPipelineMs}ms)`);
  }

  const report: DailyReport = {
    clinic_id: clinicId,
    clinic_name: clinicName,
    report_date: reportDate,
    total_calls: totalCalls,
    total_bookings: totalBookings,
    booking_rate: Math.round(bookingRate * 10) / 10,
    crisis_calls: crisisCalls,
    crisis_escalated: crisisEscalated,
    escalation_rate: Math.round(escalationRate * 10) / 10,
    avg_call_duration_sec: avgDuration,
    avg_pipeline_ms: avgPipeline,
    no_show_count: noShowCount,
    no_show_rate: Math.round(noShowRate * 10) / 10,
    intent_distribution: intentDistribution,
    sentiment_distribution: sentimentDistribution,
    targets_met: targetsMet,
    targets_missed: targetsMissed,
  };

  // Save to DB
  await execute(
    `INSERT INTO performance_reports (clinic_id, report_date, report_data)
     VALUES ($1, $2, $3)
     ON CONFLICT (clinic_id, report_date) DO UPDATE SET report_data = $3, updated_at = NOW()`,
    [clinicId, reportDate, JSON.stringify(report)]
  );

  // Log summary
  const status = targetsMissed.length === 0 ? "ALL TARGETS MET" : `${targetsMissed.length} TARGETS MISSED`;
  logger.info(
    `[PERFORMANCE] ${clinicName} (${reportDate}): ${totalCalls} calls, ${totalBookings} bookings (${bookingRate.toFixed(1)}%), ` +
    `${crisisCalls} crises, ${noShowRate.toFixed(1)}% no-show — ${status}`
  );
  if (targetsMissed.length > 0) {
    for (const miss of targetsMissed) {
      logger.warn(`[PERFORMANCE] ${clinicName}: MISSED — ${miss}`);
    }
  }
}

/**
 * Start the performance report scheduler.
 * Checks every hour; runs report when hour === 0 (midnight).
 */
let performanceInterval: ReturnType<typeof setInterval> | null = null;

export function startPerformanceScheduler(): void {
  if (!isDbAvailable()) {
    logger.info("[PERFORMANCE] Skipped — no database available");
    return;
  }

  if (performanceInterval) {
    clearInterval(performanceInterval);
    performanceInterval = null;
  }

  const INTERVAL_MS = 60 * 60 * 1000;

  setTimeout(() => {
    const now = new Date();
    if (now.getHours() === 0) {
      generateDailyReport();
    }

    performanceInterval = setInterval(() => {
      const current = new Date();
      if (current.getHours() === 0 && current.getMinutes() < 5) {
        generateDailyReport();
      }
    }, INTERVAL_MS);
  }, 60_000);

  logger.info("[PERFORMANCE] Scheduler started (daily at midnight)");
}

export function stopPerformanceScheduler(): void {
  if (performanceInterval) {
    clearInterval(performanceInterval);
    performanceInterval = null;
  }
}
