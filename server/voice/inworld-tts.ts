/**
 * inworld-tts.ts — Streaming text-to-speech via Inworld TTS
 *
 * Converts text to speech using Inworld TTS-1.5 Max (ranked #1 quality).
 * Uses HTTP streaming endpoint for sentence-level synthesis.
 * Outputs MULAW 8kHz audio natively — no conversion needed for Twilio.
 *
 * Replaces ElevenLabs Turbo v2.5 (20x cheaper, better quality).
 */

import { EventEmitter } from "events";
import { withRetry } from "./retry";
import logger from "../lib/logger";

export interface InworldTTSOptions {
  apiKey?: string | null;
  voiceId?: string;
  modelId?: string;
  sampleRate?: number;
  speakingRate?: number;
  temperature?: number;
  language?: string;  // "en", "es", etc. — switches voice for multilingual
}

const DEFAULT_OPTIONS: Required<InworldTTSOptions> = {
  apiKey: null,
  voiceId: "Ashley",                // Warm, professional female voice
  modelId: "inworld-tts-1.5-max",  // #1 ranked on Artificial Analysis (ELO 1,163)
  sampleRate: 8000,                 // 8kHz for Twilio mulaw
  speakingRate: 1.0,
  temperature: 1.0,
  language: "en",
};

export class InworldTTS extends EventEmitter {
  private options: Required<InworldTTSOptions>;
  private apiKey: string | null;
  private isGenerating = false;
  private abortController: AbortController | null = null;
  private synthesisQueue: string[] = [];
  private isProcessingQueue = false;

  constructor(options?: InworldTTSOptions) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.apiKey = options?.apiKey || process.env.INWORLD_API_KEY || null;

    // Allow override from env
    if (process.env.INWORLD_VOICE_ID) {
      this.options.voiceId = process.env.INWORLD_VOICE_ID;
    }
    if (process.env.INWORLD_MODEL_ID) {
      this.options.modelId = process.env.INWORLD_MODEL_ID;
    }

    // Switch voice for non-English languages (Inworld TTS-1.5 Max is multilingual)
    if (options?.language && options.language !== "en") {
      const envKey = `INWORLD_VOICE_${options.language.toUpperCase()}`;
      if (process.env[envKey]) {
        this.options.voiceId = process.env[envKey]!;
      }
      logger.info(`[TTS] Multilingual mode: language=${options.language}, voice=${this.options.voiceId}`);
    }

    if (!this.apiKey) {
      logger.warn("[TTS] No INWORLD_API_KEY — running in simulation mode");
    }
  }

  /**
   * Convert text to speech and emit audio chunks.
   * If synthesis is already in progress, queues the text for seamless playback.
   * Emits "audio" events with base64-encoded mulaw audio (ready for Telnyx).
   * Emits "done" when the queue is fully drained.
   */
  async synthesize(text: string): Promise<void> {
    if (!text.trim()) return;

    if (this.isGenerating) {
      // Queue for seamless back-to-back playback (eliminates inter-sentence gaps)
      this.synthesisQueue.push(text);
      return;
    }

    await this.synthesizeImmediate(text);

    // Process queue if items were added during synthesis
    this.drainQueue();
  }

  /**
   * Internal: synthesize a single text chunk immediately
   */
  private async synthesizeImmediate(text: string): Promise<void> {
    if (!text.trim()) return;

    this.isGenerating = true;
    this.abortController = new AbortController();

    // Simulation mode
    if (!this.apiKey) {
      await this.simulateTTS(text);
      this.isGenerating = false;
      return;
    }

    try {
      // Use HTTP streaming endpoint — returns audio chunks progressively
      const url = "https://api.inworld.ai/tts/v1/voice:stream";

      const response = await withRetry(() => fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Basic ${Buffer.from(this.apiKey + ":").toString("base64")}`,
        },
        body: JSON.stringify({
          text,
          voiceId: this.options.voiceId,
          modelId: this.options.modelId,
          audioConfig: {
            audioEncoding: "MULAW",        // Native mulaw — no conversion needed for Twilio!
            sampleRateHertz: this.options.sampleRate,
            speakingRate: this.options.speakingRate,
          },
          temperature: this.options.temperature,
          applyTextNormalization: "ON",
        }),
        signal: this.abortController!.signal,
      }), { maxRetries: 1, baseDelayMs: 100, label: "Inworld TTS" });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Inworld API error ${response.status}: ${errText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      // Read streaming JSON chunks
      let chunkCount = 0;
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (this.abortController?.signal.aborted) break;

        // Accumulate text from the stream
        buffer += new TextDecoder().decode(value, { stream: true });

        // Parse complete JSON objects from the stream
        // Inworld streams newline-delimited JSON
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";  // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const chunk = JSON.parse(trimmed);

            // Extract audio content from the response
            const audioContent = chunk?.result?.audioChunk?.audioContent
              || chunk?.audioContent;

            if (audioContent) {
              // Inworld returns base64-encoded MULAW audio
              // Already in the right format for Twilio — emit directly
              this.emit("audio", audioContent);
              chunkCount++;
            }

            // Check for errors in the stream
            if (chunk?.error) {
              logger.error(`[TTS] Inworld stream error: ${chunk.error.message}`);
            }
          } catch {
            // Not a complete JSON object yet, skip
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const chunk = JSON.parse(buffer.trim());
          const audioContent = chunk?.result?.audioChunk?.audioContent
            || chunk?.audioContent;
          if (audioContent) {
            this.emit("audio", audioContent);
            chunkCount++;
          }
        } catch {
          // Incomplete JSON, ignore
        }
      }

      logger.debug(`[TTS] Synthesized ${text.length} chars, ${chunkCount} audio chunks`);
    } catch (err: any) {
      if (err.name === "AbortError") {
        logger.info("[TTS] Synthesis aborted (interruption)");
      } else {
        logger.error("[TTS] Inworld error:", err.message);
      }
    } finally {
      this.isGenerating = false;
      this.abortController = null;
      // Only emit "done" if queue is empty (more chunks may follow)
      if (this.synthesisQueue.length === 0) {
        this.emit("done");
      }
    }
  }

  /**
   * Process queued synthesis requests for seamless back-to-back playback.
   * Runs asynchronously — each queued chunk starts as soon as the previous ends.
   */
  private async drainQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    while (this.synthesisQueue.length > 0) {
      const next = this.synthesisQueue.shift()!;
      await this.synthesizeImmediate(next);
    }

    this.isProcessingQueue = false;
  }

  /**
   * Stop current TTS generation and clear the queue (for interruption handling)
   */
  interrupt(): void {
    this.synthesisQueue = [];
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isGenerating = false;
    this.isProcessingQueue = false;
  }

  /**
   * Simulation mode — emit silence with timing that approximates real TTS
   */
  private async simulateTTS(text: string): Promise<void> {
    // Approximate: 150 words per minute, ~5 chars per word
    const durationMs = Math.max(200, (text.length / 5 / 150) * 60 * 1000);
    const chunkCount = Math.ceil(durationMs / 20); // 20ms chunks

    // Generate silence chunks (mulaw silence = 0xFF)
    const silenceChunk = Buffer.alloc(160, 0xff); // 160 samples = 20ms at 8kHz
    const silenceBase64 = silenceChunk.toString("base64");

    for (let i = 0; i < chunkCount; i++) {
      if (this.abortController?.signal.aborted) break;
      this.emit("audio", silenceBase64);
      await new Promise((r) => setTimeout(r, 20));
    }

    this.emit("done");
  }

  get generating(): boolean {
    return this.isGenerating;
  }
}
