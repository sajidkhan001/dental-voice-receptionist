/**
 * self-improver-service.ts — Daily call quality analyzer
 *
 * Runs daily at 1 AM. Reviews failed/low-quality calls from the previous day
 * and uses Claude to generate improvement suggestions.
 *
 * IMPORTANT: Never auto-applies changes. Only suggests — human-in-the-loop.
 */

import { query, queryOne, execute, isDbAvailable } from "../lib/db";
import logger from "../lib/logger";

interface FlaggedCall {
  id: string;
  clinic_id: string;
  call_id: string;
  transcript: string;
  intent: string;
  crisis_detected: boolean;
  sentiment: string | null;
  call_summary: string | null;
  pipeline_duration_ms: number | null;
  booking_confirmed: boolean;
}

interface ImprovementSuggestion {
  call_log_id: string;
  clinic_id: string;
  category: string;
  suggestion: string;
  priority: "high" | "medium" | "low";
}

/**
 * Analyze yesterday's problematic calls and generate improvement suggestions.
 */
export async function analyzeAndSuggest(): Promise<void> {
  if (!isDbAvailable()) return;

  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const reportDate = yesterday.toISOString().split("T")[0];

    // Find problematic calls:
    // 1. Crisis calls (always review)
    // 2. Negative/frustrated sentiment
    // 3. Very short calls (<30s with transcript — likely caller hung up)
    // 4. Calls where booking was expected (book_appointment intent) but not confirmed
    const flaggedCalls = await query<FlaggedCall>(
      `SELECT id, clinic_id, call_id, transcript, intent, crisis_detected,
              sentiment, call_summary, pipeline_duration_ms, booking_confirmed
       FROM call_logs
       WHERE created_at::date = $1
         AND (
           crisis_detected = true
           OR sentiment IN ('negative', 'frustrated')
           OR (intent = 'book_appointment' AND booking_confirmed = false)
           OR (duration_seconds < 30 AND transcript IS NOT NULL AND LENGTH(transcript) > 50)
         )
       ORDER BY created_at
       LIMIT 50`,
      [reportDate]
    );

    if (flaggedCalls.length === 0) {
      logger.info(`[SELF-IMPROVER] No flagged calls on ${reportDate} — great day!`);
      return;
    }

    logger.info(`[SELF-IMPROVER] Found ${flaggedCalls.length} flagged calls on ${reportDate}`);

    const suggestions: ImprovementSuggestion[] = [];

    // Try Claude analysis if API key available
    if (process.env.ANTHROPIC_API_KEY) {
      const claudeSuggestions = await analyzeWithClaude(flaggedCalls);
      suggestions.push(...claudeSuggestions);
    } else {
      // Fallback: rule-based analysis
      const ruleSuggestions = analyzeWithRules(flaggedCalls);
      suggestions.push(...ruleSuggestions);
    }

    // Save suggestions to DB
    for (const suggestion of suggestions) {
      await execute(
        `INSERT INTO improvement_suggestions (clinic_id, call_log_id, category, suggestion, priority)
         VALUES ($1, $2, $3, $4, $5)`,
        [suggestion.clinic_id, suggestion.call_log_id, suggestion.category, suggestion.suggestion, suggestion.priority]
      );
    }

    logger.info(`[SELF-IMPROVER] Generated ${suggestions.length} improvement suggestions for ${reportDate}`);
    for (const s of suggestions.slice(0, 5)) {
      logger.info(`[SELF-IMPROVER] [${s.priority}] ${s.category}: ${s.suggestion.slice(0, 100)}...`);
    }
  } catch (err: any) {
    logger.error("[SELF-IMPROVER] Analysis failed:", err.message);
  }
}

/**
 * Claude-powered analysis of flagged calls.
 */
async function analyzeWithClaude(calls: FlaggedCall[]): Promise<ImprovementSuggestion[]> {
  const suggestions: ImprovementSuggestion[] = [];

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

    // Batch calls into a single prompt (max 5 at a time for cost efficiency)
    const batches = [];
    for (let i = 0; i < calls.length; i += 5) {
      batches.push(calls.slice(i, i + 5));
    }

    for (const batch of batches) {
      const callSummaries = batch.map((c, i) => {
        const flags: string[] = [];
        if (c.crisis_detected) flags.push("CRISIS");
        if (c.sentiment === "negative" || c.sentiment === "frustrated") flags.push(`SENTIMENT:${c.sentiment}`);
        if (c.intent === "book_appointment" && !c.booking_confirmed) flags.push("MISSED_BOOKING");
        return `Call ${i + 1} (ID: ${c.call_id}, flags: ${flags.join(",")}):
${c.transcript.slice(0, 500)}${c.transcript.length > 500 ? "..." : ""}`;
      }).join("\n\n---\n\n");

      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: [{
          type: "text" as const,
          text: `You are a dental AI quality analyst. Review flagged voice calls and suggest specific improvements. Return ONLY valid JSON array. Each suggestion: {"call_index": number, "category": "prompt"|"escalation"|"booking"|"tone"|"compliance", "suggestion": "specific actionable text", "priority": "high"|"medium"|"low"}`,
          cache_control: { type: "ephemeral" as const },
        }],
        messages: [{
          role: "user",
          content: `Review these flagged dental clinic AI calls and suggest improvements:\n\n${callSummaries}\n\nReturn JSON array of suggestions.`,
        }],
      });

      const text = response.content[0].type === "text" ? response.content[0].text : "[]";
      const jsonStr = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

      try {
        const parsed = JSON.parse(jsonStr) as Array<{
          call_index: number;
          category: string;
          suggestion: string;
          priority: "high" | "medium" | "low";
        }>;

        for (const item of parsed) {
          const call = batch[item.call_index - 1];
          if (call) {
            suggestions.push({
              call_log_id: call.id,
              clinic_id: call.clinic_id,
              category: item.category,
              suggestion: item.suggestion,
              priority: item.priority,
            });
          }
        }
      } catch {
        logger.warn("[SELF-IMPROVER] Failed to parse Claude response, falling back to rules");
        suggestions.push(...analyzeWithRules(batch));
      }
    }
  } catch (err: any) {
    logger.error("[SELF-IMPROVER] Claude analysis failed:", err.message);
    suggestions.push(...analyzeWithRules(calls));
  }

  return suggestions;
}

/**
 * Rule-based fallback analysis when Claude API is unavailable.
 */
function analyzeWithRules(calls: FlaggedCall[]): ImprovementSuggestion[] {
  const suggestions: ImprovementSuggestion[] = [];

  for (const call of calls) {
    if (call.crisis_detected) {
      suggestions.push({
        call_log_id: call.id,
        clinic_id: call.clinic_id,
        category: "escalation",
        suggestion: "Crisis call detected — review transcript to ensure escalation was timely and empathetic. Check if transfer completed successfully.",
        priority: "high",
      });
    }

    if (call.intent === "book_appointment" && !call.booking_confirmed) {
      suggestions.push({
        call_log_id: call.id,
        clinic_id: call.clinic_id,
        category: "booking",
        suggestion: "Caller intended to book but no booking was confirmed. Review transcript for: availability issues, caller dropping off, or AI failing to collect required info.",
        priority: "high",
      });
    }

    if (call.sentiment === "frustrated" || call.sentiment === "negative") {
      suggestions.push({
        call_log_id: call.id,
        clinic_id: call.clinic_id,
        category: "tone",
        suggestion: `Caller sentiment was "${call.sentiment}". Review transcript for: slow response time, repetitive questions, failure to acknowledge concerns, or robotic tone.`,
        priority: "medium",
      });
    }

    if (call.pipeline_duration_ms && call.pipeline_duration_ms > 3000) {
      suggestions.push({
        call_log_id: call.id,
        clinic_id: call.clinic_id,
        category: "prompt",
        suggestion: `Pipeline latency was ${call.pipeline_duration_ms}ms (target: <2000ms). Consider optimizing system prompt length or checking API response times.`,
        priority: "medium",
      });
    }
  }

  return suggestions;
}

/**
 * Start the self-improver scheduler.
 * Checks every hour; runs at 1 AM.
 */
let selfImproverInterval: ReturnType<typeof setInterval> | null = null;

export function startSelfImproverScheduler(): void {
  if (!isDbAvailable()) {
    logger.info("[SELF-IMPROVER] Skipped — no database available");
    return;
  }

  if (selfImproverInterval) {
    clearInterval(selfImproverInterval);
    selfImproverInterval = null;
  }

  const INTERVAL_MS = 60 * 60 * 1000;

  setTimeout(() => {
    const now = new Date();
    if (now.getHours() === 1) {
      analyzeAndSuggest();
    }

    selfImproverInterval = setInterval(() => {
      const current = new Date();
      if (current.getHours() === 1 && current.getMinutes() < 5) {
        analyzeAndSuggest();
      }
    }, INTERVAL_MS);
  }, 90_000);

  logger.info("[SELF-IMPROVER] Scheduler started (daily at 1 AM)");
}

export function stopSelfImproverScheduler(): void {
  if (selfImproverInterval) {
    clearInterval(selfImproverInterval);
    selfImproverInterval = null;
  }
}
