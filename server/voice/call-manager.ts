/**
 * call-manager.ts — Tracks active voice calls and handles lifecycle
 *
 * Manages per-call state: conversation history, transcript accumulation,
 * and cleanup on call end (saves to DB, runs agent pipeline).
 */

import { ClinicConfig, CallData, ClinicCredentials } from "../lib/types";
import { DeepgramSTT } from "./deepgram-stt";
import { ClaudeConversation } from "./claude-conversation";
import { InworldTTS } from "./inworld-tts";
import { saveCallLog } from "../services/call-service";
import { runAgentPipeline } from "../agent-runner";
import { auditLog } from "../services/audit-service";
import logger from "../lib/logger";

export interface TurnLatency {
  sttEndTime: number;
  llmFirstTokenTime?: number;
  ttsFirstAudioTime?: number;
  endToEnd?: number;
}

export interface ActiveCall {
  callSid: string;
  streamSid: string;
  clinicId: string;
  clinicConfig: ClinicConfig;
  callerPhone: string;
  stt: DeepgramSTT;
  conversation: ClaudeConversation;
  tts: InworldTTS;
  credentials?: ClinicCredentials;
  transcript: string[];  // Accumulated caller + AI transcript lines
  startTime: Date;
  isSpeaking: boolean;   // true when TTS is outputting audio
  timeoutHandle?: ReturnType<typeof setTimeout>;
  // Latency tracking
  turnLatencies: TurnLatency[];
  currentTurnStart?: number;
  interruptionCount: number;
  errorCount: number;
}

const MAX_CONCURRENT_CALLS = parseInt(process.env.MAX_CONCURRENT_CALLS || "20", 10);
const MAX_CALL_DURATION_MS = 30 * 60 * 1000; // 30 minutes

class CallManager {
  private activeCalls = new Map<string, ActiveCall>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Periodic cleanup of zombie calls every 60 seconds
    this.cleanupInterval = setInterval(() => this.cleanupStaleCalls(), 60_000);
  }

  /**
   * Create a new call session.
   * Throws if concurrent call limit is exceeded.
   */
  createCall(
    callSid: string,
    streamSid: string,
    clinicConfig: ClinicConfig,
    callerPhone: string,
    language: string = "en",
    credentials?: ClinicCredentials
  ): ActiveCall {
    // Enforce concurrent call limit
    if (this.activeCalls.size >= MAX_CONCURRENT_CALLS) {
      logger.warn(`[CALLS] Concurrent call limit reached (${MAX_CONCURRENT_CALLS}). Rejecting ${callSid}`);
      throw new Error("MAX_CONCURRENT_CALLS_EXCEEDED");
    }

    const stt = new DeepgramSTT({
      apiKey: credentials?.deepgramApiKey,
      language: language === "en" ? "multi" : language,
    });
    const conversation = new ClaudeConversation(clinicConfig, language, credentials?.anthropicApiKey);
    const tts = new InworldTTS({
      apiKey: credentials?.inworldApiKey,
      language,
      voiceId: credentials?.inworldVoiceId || undefined,
      modelId: credentials?.inworldModelId || undefined,
    });

    const call: ActiveCall = {
      callSid,
      streamSid,
      clinicId: clinicConfig.id,
      clinicConfig,
      callerPhone,
      stt,
      conversation,
      tts,
      credentials,
      transcript: [],
      startTime: new Date(),
      isSpeaking: false,
      turnLatencies: [],
      interruptionCount: 0,
      errorCount: 0,
    };

    // Auto-timeout after MAX_CALL_DURATION_MS to prevent zombie calls
    call.timeoutHandle = setTimeout(() => {
      logger.warn(`[CALLS] Call ${callSid} hit max duration (${MAX_CALL_DURATION_MS / 60000} min). Force ending.`);
      this.endCall(callSid);
    }, MAX_CALL_DURATION_MS);

    this.activeCalls.set(callSid, call);
    logger.info(`[CALLS] New call: ${callSid} for clinic ${clinicConfig.name} from ${callerPhone} (active: ${this.activeCalls.size}/${MAX_CONCURRENT_CALLS})`);
    return call;
  }

  /**
   * Get an active call by SID
   */
  getCall(callSid: string): ActiveCall | undefined {
    return this.activeCalls.get(callSid);
  }

  /**
   * Get call by stream SID
   */
  getCallByStream(streamSid: string): ActiveCall | undefined {
    for (const call of this.activeCalls.values()) {
      if (call.streamSid === streamSid) return call;
    }
    return undefined;
  }

  /**
   * Add transcript line
   */
  addTranscript(callSid: string, role: "caller" | "ai", text: string): void {
    const call = this.activeCalls.get(callSid);
    if (call) {
      call.transcript.push(`${role === "caller" ? "CALLER" : "AI"}: ${text}`);
    }
  }

  /**
   * Record a latency measurement for the current turn
   */
  recordTurnLatency(callSid: string, latency: TurnLatency): void {
    const call = this.activeCalls.get(callSid);
    if (call) {
      call.turnLatencies.push(latency);
    }
  }

  /**
   * Record an interruption
   */
  recordInterruption(callSid: string): void {
    const call = this.activeCalls.get(callSid);
    if (call) call.interruptionCount++;
  }

  /**
   * Record an error
   */
  recordError(callSid: string): void {
    const call = this.activeCalls.get(callSid);
    if (call) call.errorCount++;
  }

  /**
   * End a call — cleanup, save to DB, run pipeline
   */
  async endCall(callSid: string): Promise<void> {
    const call = this.activeCalls.get(callSid);
    if (!call) return;

    // Clear the auto-timeout
    if (call.timeoutHandle) {
      clearTimeout(call.timeoutHandle);
    }

    const duration = Math.round((Date.now() - call.startTime.getTime()) / 1000);
    const fullTranscript = call.transcript.join("\n");
    const qualityScore = this.computeQualityScore(call, duration);

    logger.info(`[CALLS] Call ended: ${callSid}, duration: ${duration}s, quality: ${qualityScore}/100, transcript lines: ${call.transcript.length}`);

    // Clean up real-time components
    call.stt.close();
    call.conversation.destroy();
    call.tts.interrupt();

    // Remove from active calls
    this.activeCalls.delete(callSid);

    // Save and process in background (don't block call cleanup)
    this.processCallEnd(callSid, call.clinicId, call.clinicConfig, call.callerPhone, fullTranscript, duration).catch((err) => {
      logger.error(`[CALLS] Post-call processing failed for ${callSid}:`, err.message);
    });
  }

  /**
   * Post-call processing — save to DB and run agent pipeline
   */
  private async processCallEnd(
    callSid: string,
    clinicId: string,
    clinicConfig: ClinicConfig,
    callerPhone: string,
    transcript: string,
    durationSeconds: number
  ): Promise<void> {
    if (!transcript.trim()) {
      logger.info(`[CALLS] Empty transcript for ${callSid}, skipping pipeline`);
      return;
    }

    const callData: CallData = {
      call_id: callSid,
      transcript,
      caller_phone: callerPhone,
      timestamp: new Date().toISOString(),
      duration_seconds: durationSeconds,
    };

    try {
      // Run the existing agent pipeline (regex-based analysis)
      const result = await runAgentPipeline(callData, clinicConfig);

      logger.info(`[CALLS] Pipeline complete for ${callSid}: intent=${result.intent}, booking=${result.booking_confirmed}`);

      // Audit log
      await auditLog({
        clinicId,
        userId: "system",
        action: "voice_call_processed",
        details: {
          call_id: callSid,
          intent: result.intent,
          duration_seconds: durationSeconds,
          booking_confirmed: result.booking_confirmed,
          crisis_detected: result.crisis_detected,
        },
      });
    } catch (err: any) {
      logger.error(`[CALLS] Pipeline error for ${callSid}:`, err.message);
    }
  }

  /**
   * Get count of active calls
   */
  get activeCallCount(): number {
    return this.activeCalls.size;
  }

  /**
   * Compute a quality score (0-100) for a completed call
   */
  private computeQualityScore(call: ActiveCall, durationSeconds: number): number {
    let score = 100;

    // Penalize high average latency (target: <500ms)
    if (call.turnLatencies.length > 0) {
      const avgLatency = call.turnLatencies.reduce((sum, t) => sum + (t.endToEnd || 0), 0) / call.turnLatencies.length;
      if (avgLatency > 1000) score -= 30;
      else if (avgLatency > 700) score -= 20;
      else if (avgLatency > 500) score -= 10;
    }

    // Penalize many interruptions (more than 3 = potentially choppy)
    if (call.interruptionCount > 5) score -= 15;
    else if (call.interruptionCount > 3) score -= 8;

    // Penalize errors/retries
    score -= Math.min(call.errorCount * 10, 30);

    // Very short calls (<15s) often indicate problems
    if (durationSeconds < 15 && call.transcript.length > 0) score -= 20;

    // Empty calls = worst quality
    if (call.transcript.length === 0) score -= 40;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Clean up stale/zombie calls that exceeded max duration
   */
  private cleanupStaleCalls(): void {
    const now = Date.now();
    for (const [callSid, call] of this.activeCalls) {
      const elapsed = now - call.startTime.getTime();
      if (elapsed > MAX_CALL_DURATION_MS + 60_000) {
        logger.warn(`[CALLS] Cleaning up stale call: ${callSid} (elapsed: ${Math.round(elapsed / 1000)}s)`);
        this.endCall(callSid).catch(() => {});
      }
    }
  }

  /**
   * Get latency statistics for the status endpoint
   */
  getLatencyStats(): { avgTurnMs: number; p95TurnMs: number; activeCalls: number } {
    const allLatencies: number[] = [];
    for (const call of this.activeCalls.values()) {
      for (const turn of call.turnLatencies) {
        if (turn.endToEnd) allLatencies.push(turn.endToEnd);
      }
    }

    if (allLatencies.length === 0) {
      return { avgTurnMs: 0, p95TurnMs: 0, activeCalls: this.activeCalls.size };
    }

    allLatencies.sort((a, b) => a - b);
    const avg = Math.round(allLatencies.reduce((s, v) => s + v, 0) / allLatencies.length);
    const p95Index = Math.floor(allLatencies.length * 0.95);
    const p95 = allLatencies[p95Index] || allLatencies[allLatencies.length - 1];

    return { avgTurnMs: avg, p95TurnMs: Math.round(p95), activeCalls: this.activeCalls.size };
  }

  /**
   * Force-close all calls (for server shutdown)
   */
  async closeAll(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    const sids = [...this.activeCalls.keys()];
    for (const sid of sids) {
      await this.endCall(sid);
    }
  }
}

// Singleton
export const callManager = new CallManager();
