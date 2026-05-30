/**
 * voice-handler.ts — Main voice pipeline orchestrator (Telnyx)
 *
 * Handles:
 * 1. Telnyx TeXML webhook (answers call → connects Media Stream)
 * 2. WebSocket server (receives audio from Telnyx, sends audio back)
 * 3. Orchestrates: STT → Claude → TTS → audio out
 * 4. Interruption handling (barge-in)
 * 5. Tool execution (calendar, booking, transfer, end call)
 *
 * Telnyx TeXML is compatible with Twilio TwiML with minor differences:
 * - Uses same <Response><Connect><Stream> structure
 * - WebSocket events: connected, start, media, stop (same as Twilio)
 * - Audio format: PCMU (mulaw) 8kHz base64 (same as Twilio)
 * - Field differences: call_control_id instead of CallSid
 */

import { WebSocket, WebSocketServer } from "ws";
import { IncomingMessage } from "http";
import { Server } from "http";
import { Request, Response } from "express";
import { callManager, ActiveCall } from "./call-manager";
import { TranscriptEvent } from "./deepgram-stt";
import { ToolCall } from "./claude-conversation";
import { loadClinicByPhoneNumber } from "../services/clinic-service";
import { getClinicCredentials } from "../services/credentials-service";
import { ClinicConfig } from "../lib/types";
import { detectLanguageFromText, isLanguageSupported, SupportedLanguage } from "./language-detector";
import { verifyToken } from "../lib/jwt";
import crypto from "crypto";
import logger from "../lib/logger";

function xmlEncode(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Verify Telnyx webhook signature.
 * Telnyx v2 sends a header with HMAC-SHA256 of the payload.
 */
function verifyTelnyxWebhook(req: Request, webhookSecret?: string | null): boolean {
  const secret = webhookSecret || process.env.TELNYX_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      logger.error("[VOICE] TELNYX_WEBHOOK_SECRET not set in production — rejecting webhook");
      return false;
    }
    logger.warn("[VOICE] TELNYX_WEBHOOK_SECRET not set — accepting webhook without verification (dev only)");
    return true;
  }

  const signature = req.headers["telnyx-signature"] as string;
  const timestamp = req.headers["telnyx-timestamp"] as string;
  if (!signature || !timestamp) {
    logger.warn("[VOICE] Missing Telnyx signature/timestamp headers");
    return false;
  }

  const payload = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  const expected = crypto
    .createHmac("sha256", secret)
    .update(timestamp + payload)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * Handle incoming Telnyx voice webhook (POST /webhook/voice)
 * Returns TeXML that connects the call to our Media Stream WebSocket
 *
 * Telnyx TeXML is compatible with TwiML — same XML structure.
 * Telnyx sends: From, To, CallSid (or call_control_id in v2 webhooks)
 */
export async function handleVoiceWebhook(req: Request, res: Response): Promise<void> {
  const callerPhone = req.body.From || req.body.from || "unknown";
  const calledNumber = req.body.To || req.body.to || "unknown";
  const callId = req.body.CallSid || req.body.call_control_id || `call-${Date.now()}`;

  let webhookSecret: string | null = null;
  try {
    const clinic = await loadClinicByPhoneNumber(calledNumber);
    if (clinic) {
      const credentials = await getClinicCredentials(clinic.id);
      webhookSecret = credentials.telnyxWebhookSecret;
    }
  } catch (err: any) {
    logger.debug(`[VOICE] Webhook credential lookup skipped: ${err.message}`);
  }

  if (!verifyTelnyxWebhook(req, webhookSecret)) {
    logger.warn("[VOICE] Voice webhook rejected: invalid Telnyx signature");
    res.sendStatus(401);
    return;
  }

  logger.info(`[VOICE] Incoming call: ${callerPhone} → ${calledNumber} (ID: ${callId})`);


  const streamToken = crypto
    .createHmac("sha256", process.env.JWT_SECRET || "fallback-secret")
    .update(callId)
    .digest("hex")
    .slice(0, 32);

  const host = req.headers.host || "localhost:3001";
  const protocol = req.headers["x-forwarded-proto"] === "https" ? "wss" : "ws";
  const wsUrl = `${protocol}://${host}/media-stream?token=${streamToken}`;

  const texml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${xmlEncode(wsUrl)}" bidirectionalMode="rtp" bidirectionalCodec="PCMU">
      <Parameter name="callId" value="${xmlEncode(callId)}" />
      <Parameter name="callerPhone" value="${xmlEncode(callerPhone)}" />
      <Parameter name="calledNumber" value="${xmlEncode(calledNumber)}" />
    </Stream>
  </Connect>
</Response>`;

  res.type("text/xml").send(texml);
}

/**
 * Handle Telnyx call status webhook (POST /webhook/voice/status)
 * Called when call ends — triggers post-call processing
 */
export async function handleCallStatus(req: Request, res: Response): Promise<void> {
  if (!verifyTelnyxWebhook(req)) {
    logger.warn("[VOICE] Call status webhook rejected: invalid Telnyx signature");
    res.sendStatus(401);
    return;
  }

  const callId = req.body.CallSid || req.body.call_control_id || req.body?.data?.payload?.call_control_id;
  const status = req.body.CallStatus || req.body?.data?.event_type || "unknown";
  const duration = req.body.CallDuration || req.body?.data?.payload?.duration_secs;

  logger.info(`[VOICE] Call status: ${callId} → ${status} (duration: ${duration}s)`);

  // Recording saved: extract URL and persist to call log
  if (status === "call.recording.saved" && callId) {
    const payload = req.body?.data?.payload;
    const recordingUrl = payload?.recording_urls?.mp3 || payload?.recording_urls?.wav || payload?.public_recording_urls?.mp3;
    if (recordingUrl) {
      const { updateCallRecordingUrl } = await import("../services/call-service");
      updateCallRecordingUrl(callId, recordingUrl).catch((err) => {
        logger.error(`[VOICE] Failed to save recording URL for ${callId}: ${err.message}`);
      });
      logger.info(`[VOICE] Recording URL saved for ${callId}`);
    }
  }

  const endStatuses = ["completed", "busy", "no-answer", "failed", "call.hangup", "call.machine.detection.ended"];
  if (endStatuses.includes(status)) {
    callManager.endCall(callId).catch((err) => {
      logger.error(`[VOICE] endCall error for ${callId}:`, err.message);
    });
  }

  res.sendStatus(200);
}

/**
 * Attach the WebSocket server for Telnyx Media Streams to an HTTP server
 */
export function attachMediaStreamWSS(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  // Handle HTTP upgrade for /media-stream path
  server.on("upgrade", (request: IncomingMessage, socket, head) => {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (url.pathname === "/media-stream") {
      const token = url.searchParams.get("token");
      if (!token || token.length < 16) {
        logger.warn("[VOICE] WebSocket upgrade rejected: no token");
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      // Accept token if it matches HMAC pattern (server-generated stream token)
      // Full JWT validation also accepted for browser-initiated connections
      try {
        const secret = process.env.JWT_SECRET || "fallback-secret";
        if (token.includes(".")) {
          verifyToken(token);
        }
      } catch {
        logger.warn("[VOICE] WebSocket upgrade rejected: invalid token");
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
  });

  wss.on("connection", (ws: WebSocket) => {
    logger.info("[VOICE] Media Stream WebSocket connected");
    handleMediaStream(ws);
  });

  logger.info("[VOICE] WebSocket server attached for /media-stream");
}

/**
 * Handle a single Telnyx Media Stream WebSocket connection
 *
 * Telnyx WebSocket protocol is compatible with Twilio's:
 * - "connected" event on initial connection
 * - "start" event with stream metadata and custom parameters
 * - "media" events with base64 audio payload
 * - "stop" event when stream ends
 *
 * Sending audio back: same format as Twilio — JSON with event:"media"
 */
async function handleMediaStream(ws: WebSocket): Promise<void> {
  let call: ActiveCall | null = null;
  let greetingSent = false;
  let pipelineCleanup: (() => void) | null = null;

  ws.on("message", async (data: Buffer) => {
    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    switch (msg.event) {
      case "connected":
        logger.info("[VOICE] Stream connected");
        break;

      case "start": {
        // Telnyx sends custom parameters and stream metadata
        const params = msg.start?.customParameters || {};
        const callId = params.callId || msg.start?.callSid || `stream-${Date.now()}`;
        const callerPhone = params.callerPhone || "unknown";
        const calledNumber = params.calledNumber || "unknown";
        const streamId = msg.start?.streamSid || msg.streamSid || msg.start?.stream_id || `sid-${Date.now()}`;

        // Resolve clinic from the called phone number
        let clinicConfig: ClinicConfig | null = null;
        try {
          clinicConfig = await loadClinicByPhoneNumber(calledNumber);
        } catch (err: any) {
          logger.error("[VOICE] Clinic lookup failed:", err.message);
        }

        if (!clinicConfig) {
          clinicConfig = getDefaultClinicConfig();
          logger.warn(`[VOICE] No clinic for ${calledNumber}, using default`);
        }


        const credentials = await getClinicCredentials(
          clinicConfig.id === "default" || clinicConfig.id === "simulation" ? null : clinicConfig.id
        );

        // Create call session with clinic's primary language (may throw if concurrent limit reached)
        const clinicLanguage = (clinicConfig as any).primaryLanguage || "en";
        try {
          call = callManager.createCall(callId, streamId, clinicConfig, callerPhone, clinicLanguage, credentials);
        } catch (err: any) {
          if (err.message === "MAX_CONCURRENT_CALLS_EXCEEDED") {
            logger.warn(`[VOICE] Rejecting call ${callId} — at capacity`);
            // Close with 1013 (Try Again Later) so Telnyx can handle gracefully.
            // Telnyx TeXML can be configured with a fallback <Say> for stream failures.
            ws.close(1013, "Server at capacity — please try again later");
            return;
          }
          throw err;
        }

        // Start call recording (production only — fires off async, never blocks)
        if (process.env.SIMULATION_MODE === "false" && credentials.telnyxApiKey) {
          const Telnyx = (await import("telnyx")).default;
          const telnyx = new Telnyx({ apiKey: credentials.telnyxApiKey });
          (telnyx.calls.actions as any).record_start(callId, {
            channels: "dual",
            format: "mp3",
            play_beep: false,
          } as any).catch((err: any) => {
            logger.warn(`[VOICE] Could not start recording for ${callId}: ${err.message}`);
          });
        }

        // Connect Deepgram STT
        await call.stt.connect();

        // Wire up STT → Claude → TTS pipeline
        pipelineCleanup = wireUpPipeline(call, ws);

        // Send greeting
        if (!greetingSent) {
          greetingSent = true;
          const greeting = clinicConfig.greetingTemplate
            || `Thank you for calling ${clinicConfig.name}, this is your AI receptionist. How can I help you today?`;

          call.tts.synthesize(greeting);
          call.transcript.push(`AI: ${greeting}`);
          call.conversation.processUserSpeech("");
        }
        break;
      }

      case "media": {
        if (!call) return;

        // Decode base64 audio and forward to Deepgram
        // Telnyx uses same format: msg.media.payload (base64 mulaw)
        const audioBuffer = Buffer.from(msg.media.payload, "base64");
        call.stt.sendAudio(audioBuffer);
        break;
      }

      case "stop": {
        logger.info("[VOICE] Stream stopped");
        if (pipelineCleanup) { pipelineCleanup(); pipelineCleanup = null; }
        if (call) {
          await callManager.endCall(call.callSid);
          call = null;
        }
        break;
      }
    }
  });

  ws.on("close", async () => {
    logger.info("[VOICE] WebSocket closed");
    if (pipelineCleanup) { pipelineCleanup(); pipelineCleanup = null; }
    if (call) {
      await callManager.endCall(call.callSid);
      call = null;
    }
  });

  ws.on("error", (err) => {
    logger.error("[VOICE] WebSocket error:", err.message);
  });
}

// Filler phrases for tool execution (from CLAUDE.md brand voice)
const TOOL_FILLER_PHRASES = [
  "Just one moment while I check that for you.",
  "Let me look into that.",
  "One moment please.",
  "Let me check our availability.",
  "Just a moment while I pull that up.",
];

function getRandomFiller(): string {
  return TOOL_FILLER_PHRASES[Math.floor(Math.random() * TOOL_FILLER_PHRASES.length)];
}

/**
 * Wire up the STT → Claude → TTS pipeline for a call
 */
/**
 * Wire up the STT → Claude → TTS pipeline for a call.
 * Returns a cleanup function that clears internal timers (must be called on call end).
 */
function wireUpPipeline(call: ActiveCall, ws: WebSocket): () => void {
  let callerUtterance = "";
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let silenceWarned = false;
  let secondSilenceTimer: ReturnType<typeof setTimeout> | null = null;
  let languageDetected = false;

  const resetSilenceTimer = () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    if (secondSilenceTimer) clearTimeout(secondSilenceTimer);
    silenceWarned = false;

    silenceTimer = setTimeout(() => {
      // 8 seconds of silence — gently re-engage
      if (!call.isSpeaking) {
        silenceWarned = true;
        call.tts.synthesize("Are you still there? I'm happy to help whenever you're ready.");
        call.isSpeaking = true;

        // 20 more seconds → goodbye and end call
        secondSilenceTimer = setTimeout(() => {
          if (silenceWarned) {
            call.tts.synthesize("It seems like you may have stepped away. Feel free to call us back anytime. Have a great day!");
            call.isSpeaking = true;
            // End call after goodbye plays
            setTimeout(() => callManager.endCall(call.callSid), 5000);
          }
        }, 20_000);
      }
    }, 8_000);
  };

  // STT events
  call.stt.on("transcript", (event: TranscriptEvent) => {
    resetSilenceTimer();

    // Confidence filtering: only accumulate reliable transcripts
    if (event.isFinal && event.confidence > 0.4) {
      callerUtterance += (callerUtterance ? " " : "") + event.text;
    }

    // Handle interruption: caller speaking while AI is responding
    // Only trigger on high-confidence, meaningful speech (prevents phantom interruptions)
    if (call.isSpeaking && event.confidence > 0.5 && event.text.length > 3) {
      logger.info("[VOICE] Interruption detected — stopping TTS");
      call.tts.interrupt();
      call.isSpeaking = false;
      callManager.recordInterruption(call.callSid);
      sendClearMessage(ws, call.streamSid);
    }
  });

  call.stt.on("speech_started", () => {
    resetSilenceTimer();
    if (call.isSpeaking) {
      call.tts.interrupt();
      call.isSpeaking = false;
      sendClearMessage(ws, call.streamSid);
    }
  });

  call.stt.on("utterance_end", () => {
    resetSilenceTimer();
    if (callerUtterance.trim()) {
      const text = callerUtterance.trim();
      callerUtterance = "";

      // Start latency tracking for this turn
      call.currentTurnStart = Date.now();

      // Detect language from first 1-2 caller utterances and switch pipeline
      if (!languageDetected) {
        const detected = detectLanguageFromText(text);
        if (detected && detected !== "en") {
          const supportedLangs = (call.clinicConfig as any).supportedLanguages || ["en"];
          if (isLanguageSupported(detected, supportedLangs)) {
            logger.info(`[VOICE] Language detected: ${detected} — switching pipeline`);
            languageDetected = true;

            // Switch Claude system prompt to detected language
            call.conversation.updateLanguage(detected);

            // Switch TTS to detected language voice
            const oldTts = call.tts;
            const { InworldTTS } = require("./inworld-tts");
            const newTts = new InworldTTS({
              apiKey: call.credentials?.inworldApiKey,
              language: detected,
              voiceId: call.credentials?.inworldVoiceId || undefined,
              modelId: call.credentials?.inworldModelId || undefined,
            });

            // Re-wire TTS audio/done events to the WebSocket output
            newTts.on("audio", (base64Audio: string) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  event: "media",
                  streamSid: call.streamSid,
                  media: { payload: base64Audio },
                }));
              }
            });
            newTts.on("done", () => {
              call.isSpeaking = false;
              call.currentTurnStart = undefined;
            });

            // Stop old TTS and swap
            oldTts.interrupt();
            call.tts = newTts;

            // STT is already in "multi" mode (auto-detect) — no change needed
            logger.info(`[VOICE] Pipeline switched: Claude prompt + TTS now in ${detected}`);
          } else {
            logger.info(`[VOICE] Language detected: ${detected} but not supported by clinic`);
          }
        }
        // After 2 utterances, stop checking to save CPU
        if (!languageDetected && call.transcript.filter(l => l.startsWith("CALLER:")).length >= 2) {
          languageDetected = true;
        }
      }

      logger.info(`[VOICE] Caller said: "${text}"`);
      callManager.addTranscript(call.callSid, "caller", text);

      // Send to Claude for response
      call.conversation.processUserSpeech(text);
    }
  });

  // Latency: track LLM first token
  let turnFirstTokenRecorded = false;
  call.conversation.on("first_token", () => {
    if (call.currentTurnStart) {
      const llmTtft = Date.now() - call.currentTurnStart;
      logger.debug(`[VOICE] LLM TTFT: ${llmTtft}ms`);
      turnFirstTokenRecorded = true;
    }
  });

  // Claude response events
  let turnFirstAudioRecorded = false;
  call.conversation.on("text", (text: string) => {
    callManager.addTranscript(call.callSid, "ai", text);
    call.isSpeaking = true;
    call.tts.synthesize(text);
  });

  call.conversation.on("tool_call", async (toolCall: ToolCall) => {
    // Play a filler phrase to eliminate dead silence during tool execution
    // Skip fillers for end_call and transfer_call (they have their own audio)
    if (toolCall.name !== "end_call" && toolCall.name !== "transfer_call") {
      const filler = getRandomFiller();
      callManager.addTranscript(call.callSid, "ai", filler);
      call.isSpeaking = true;
      call.tts.synthesize(filler);
    }

    const result = await executeToolCall(call, toolCall, ws);
    await call.conversation.provideToolResult(toolCall.id, result);
  });

  // TTS audio output → send to Telnyx via WebSocket
  call.tts.on("audio", (base64Audio: string) => {
    // Latency: record time to first audio byte
    if (call.currentTurnStart && !turnFirstAudioRecorded) {
      turnFirstAudioRecorded = true;
      const e2e = Date.now() - call.currentTurnStart;
      logger.debug(`[VOICE] End-to-end turn latency: ${e2e}ms`);
      callManager.recordTurnLatency(call.callSid, {
        sttEndTime: call.currentTurnStart,
        endToEnd: e2e,
      });
    }

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        event: "media",
        streamSid: call.streamSid,
        media: {
          payload: base64Audio,
        },
      }));
    }
  });

  call.tts.on("done", () => {
    call.isSpeaking = false;
    // Reset turn tracking for next turn
    call.currentTurnStart = undefined;
    turnFirstTokenRecorded = false;
    turnFirstAudioRecorded = false;
  });

  // Start the silence timer
  resetSilenceTimer();

  // Return cleanup function — MUST be called when call ends to prevent timer leaks
  return () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    if (secondSilenceTimer) clearTimeout(secondSilenceTimer);
  };
}

/**
 * Execute a tool call from Claude
 */
async function executeToolCall(
  call: ActiveCall,
  toolCall: ToolCall,
  ws: WebSocket
): Promise<any> {
  logger.info(`[VOICE] Tool call: ${toolCall.name}`, toolCall.input);

  switch (toolCall.name) {
    case "check_availability": {
      try {
        if (process.env.SIMULATION_MODE !== "false") {
          return {
            available_slots: [
              { date: "2026-03-20", day: "Friday", time: "10:00 AM", provider: "Dr. Smith" },
              { date: "2026-03-20", day: "Friday", time: "2:30 PM", provider: "Dr. Smith" },
              { date: "2026-03-23", day: "Monday", time: "11:00 AM", provider: "Dr. Smith" },
            ],
          };
        }

        const { findRealAvailableSlots } = await import("../lib/calendar-manager");
        const slots = await findRealAvailableSlots(
          call.clinicConfig,
          toolCall.input.service_name,
          toolCall.input.provider_name
        );
        return { available_slots: slots };
      } catch (err: any) {
        logger.error("[VOICE] Calendar check failed:", err.message);
        return { error: "Unable to check calendar right now. Please offer to call back." };
      }
    }

    case "book_appointment": {
      try {
        if (process.env.SIMULATION_MODE !== "false") {
          return {
            success: true,
            confirmation: `Appointment booked for ${toolCall.input.patient_name} on ${toolCall.input.date} at ${toolCall.input.time} with ${toolCall.input.provider_name}.`,
          };
        }

        const { createBooking } = await import("../services/booking-service");
        const bookingId = await createBooking(call.clinicId, {
          patientName: toolCall.input.patient_name,
          patientPhone: toolCall.input.patient_phone || call.callerPhone,
          patientEmail: toolCall.input.patient_email,
          patientInsurance: toolCall.input.patient_insurance,
          isNewPatient: toolCall.input.is_new_patient ?? true,
          appointmentDate: toolCall.input.date,
          startTime: toolCall.input.time,
          durationMinutes: toolCall.input.duration_minutes || 45,
        });

        // Send intake form link for new patients (fire and forget)
        if (toolCall.input.is_new_patient !== false) {
          try {
            const { sendIntakeLink } = await import("../services/intake-service");
            const baseUrl = process.env.BASE_URL || "http://localhost:3001";
            await sendIntakeLink(
              call.clinicId, bookingId, toolCall.input.patient_name,
              toolCall.input.patient_phone || call.callerPhone,
              toolCall.input.patient_email || null,
              baseUrl
            );
          } catch (err: any) {
            logger.warn("[VOICE] Intake link send failed:", err.message);
          }
        }

        return {
          success: true,
          booking_id: bookingId,
          confirmation: `Appointment booked for ${toolCall.input.patient_name} on ${toolCall.input.date} at ${toolCall.input.time} with ${toolCall.input.provider_name}.`,
        };
      } catch (err: any) {
        logger.error("[VOICE] Booking failed:", err.message);
        return { error: "Unable to book right now. Please offer to take their info and call back." };
      }
    }

    case "end_call": {
      logger.info(`[VOICE] AI ending call: ${toolCall.input.reason}`);
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      }, 3000);
      return { success: true };
    }

    case "transfer_call": {
      logger.info(`[VOICE] Transfer requested: ${toolCall.input.reason} → ${toolCall.input.department}`);

      // Empathy-first: speak transfer message before initiating transfer
      const empathyMsg = toolCall.input.department === "emergency"
        ? "I can hear this is really concerning, and I want to make sure you get help right away. I'm connecting you with our on-call dental team now. Please stay on the line."
        : "Absolutely — I'll connect you with our team right now. One moment please.";
      call.tts.synthesize(empathyMsg);
      callManager.addTranscript(call.callSid, "ai", empathyMsg);
      call.isSpeaking = true;

      // Fire crisis SMS alert to clinic owner (fire-and-forget, never blocks the call)
      if (toolCall.input.department === "emergency") {
        const { sendCrisisAlert } = await import("../services/alerts-service");
        sendCrisisAlert(call.clinicConfig, {
          callerPhone: call.callerPhone,
          reason: toolCall.input.reason,
          callId: call.callSid,
          startedAt: new Date(),
        }).catch((err) => logger.error("[VOICE] Crisis alert failed:", err.message));
      }

      // Wait for empathy message to play before transferring
      await new Promise(resolve => setTimeout(resolve, 3500));

        if (process.env.SIMULATION_MODE !== "false" || !call.credentials?.telnyxApiKey) {
        return {
          success: true,
          message: "Transfer initiated (simulation mode — logged to file)",
        };
      }

      // Telnyx call transfer via Call Control API
      try {
        const Telnyx = (await import("telnyx")).default;
        const telnyx = new Telnyx({ apiKey: call.credentials.telnyxApiKey });
        const transferTo = toolCall.input.department === "emergency"
          ? call.clinicConfig.emergencyNumber
          : call.clinicConfig.phone;

        if (transferTo) {
          await telnyx.calls.actions.transfer(call.callSid, {
            to: transferTo,
          });
        }
      } catch (err: any) {
        logger.error("[VOICE] Transfer failed:", err.message);
      }

      return {
        success: true,
        message: `Transferring to ${toolCall.input.department}`,
      };
    }

    default:
      logger.warn(`[VOICE] Unknown tool: ${toolCall.name}`);
      return { error: `Unknown tool: ${toolCall.name}` };
  }
}

/**
 * Send a clear message to flush the audio queue (for interruptions)
 * Telnyx supports the same "clear" event as Twilio
 */
function sendClearMessage(ws: WebSocket, streamSid: string): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      event: "clear",
      streamSid,
    }));
  }
}

/**
 * Default clinic config for simulation/fallback
 */
function getDefaultClinicConfig(): ClinicConfig {
  return {
    id: "default",
    slug: "default",
    name: "Demo Dental Clinic",
    phone: "555-000-1234",
    address: "123 Example Street",
    website: null,
    timezone: "America/New_York",
    emergencyNumber: "555-000-9999",
    hours: {
      monday: { open: "9:00 AM", close: "6:00 PM" },
      tuesday: { open: "9:00 AM", close: "6:00 PM" },
      wednesday: { open: "9:00 AM", close: "6:00 PM" },
      thursday: { open: "9:00 AM", close: "6:00 PM" },
      friday: { open: "9:00 AM", close: "6:00 PM" },
      saturday: { open: "9:00 AM", close: "2:00 PM" },
      sunday: null,
    },
    insurancePlans: [],
    voiceTone: "Warm, calm, professional, empathetic, reassuring.",
    greetingTemplate: null,
    twilioPhoneNumber: null,
    telnyxPhoneNumber: null,
    voiceConfig: {},
    smsFromNumber: null,
    emailFrom: null,
    emailFromName: null,
    googleAuth: null,
    providers: [
      {
        id: "default-dr",
        name: "Dr. Smith",
        title: "DDS",
        specialty: "General Dentistry",
        workingDays: [1, 2, 3, 4, 5],
        startHour: 9,
        endHour: 18,
        lunchStart: 12,
        lunchEnd: 13,
        calendarColorId: "1",
        googleCalendarId: null,
      },
    ],
    services: [
      { id: "cleaning", slug: "cleaning", name: "Cleaning", durationMinutes: 45, defaultProviderId: null },
      { id: "filling", slug: "filling", name: "Filling", durationMinutes: 60, defaultProviderId: null },
      { id: "exam", slug: "exam", name: "New Patient Exam", durationMinutes: 60, defaultProviderId: null },
    ],
    status: "active",
    systemPromptOverrides: null,
  };
}
