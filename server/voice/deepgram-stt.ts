/**
 * deepgram-stt.ts — Real-time speech-to-text via Deepgram Nova-2
 *
 * Receives mulaw audio chunks from Telnyx Media Stream,
 * forwards to Deepgram's live transcription WebSocket,
 * and emits interim/final transcript events.
 *
 * Uses @deepgram/sdk v5 API.
 * Auto-reconnects on unexpected disconnection (up to 3 retries).
 */

import { DeepgramClient } from "@deepgram/sdk";
import { EventEmitter } from "events";
import logger from "../lib/logger";

export interface TranscriptEvent {
  text: string;
  isFinal: boolean;
  confidence: number;
  speechFinal: boolean; // true when speaker finished their utterance (endpointing)
}

export interface DeepgramSTTOptions {
  apiKey?: string | null;
  language?: string;
  model?: string;
  endpointingMs?: number;
  encoding?: string;
  sampleRate?: number;
}

const DEFAULT_OPTIONS: Required<DeepgramSTTOptions> = {
  apiKey: null,
  language: "multi",  // Auto-detect language (supports en, es, fr, etc.)
  model: "nova-2-phonecall",
  endpointingMs: 200,
  encoding: "mulaw",
  sampleRate: 8000,
};

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAYS = [500, 1000, 2000]; // Exponential backoff

export class DeepgramSTT extends EventEmitter {
  private socket: any = null;
  private isConnected = false;
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
  private options: Required<Omit<DeepgramSTTOptions, "apiKey">> & { apiKey: string | null };
  private intentionalClose = false;
  private reconnectAttempts = 0;
  private isReconnecting = false;

  constructor(options?: DeepgramSTTOptions) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options, apiKey: options?.apiKey || null };
  }

  /**
   * Connect to Deepgram's live transcription WebSocket
   */
  async connect(): Promise<void> {
    const apiKey = this.options.apiKey || process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      logger.warn("[STT] No DEEPGRAM_API_KEY — running in simulation mode");
      this.isConnected = true;
      return;
    }

    await this.establishConnection(apiKey);
  }

  /**
   * Internal: establish the Deepgram WebSocket connection
   */
  private async establishConnection(apiKey: string): Promise<void> {
    const client = new DeepgramClient({ apiKey });

    // v5 SDK: client.listen.v1.connect() returns Promise<V1Socket>
    this.socket = await client.listen.v1.connect({
      model: this.options.model,
      language: this.options.language,
      encoding: this.options.encoding,
      sample_rate: this.options.sampleRate,
      channels: 1,
      smart_format: true,
      punctuate: true,
      interim_results: true,
      endpointing: this.options.endpointingMs,
      utterance_end_ms: 700,
      vad_events: true,
      Authorization: `Token ${apiKey}`,
    } as any);

    // V1Socket events: open, message, close, error
    this.socket.on("open", () => {
      this.isConnected = true;
      this.reconnectAttempts = 0; // Reset on successful connection
      logger.info("[STT] Deepgram connection opened");

      // Send keepalive every 10s to prevent timeout
      this.keepAliveInterval = setInterval(() => {
        if (this.socket && this.isConnected) {
          try {
            this.socket.sendKeepAlive({});
          } catch {
            // ignore
          }
        }
      }, 10_000);
    });

    this.socket.on("message", (data: any) => {
      if (!data) return;

      switch (data.type) {
        case "Results": {
          const alternative = data.channel?.alternatives?.[0];
          if (!alternative) return;

          const text = alternative.transcript?.trim();
          if (!text) return;

          const event: TranscriptEvent = {
            text,
            isFinal: data.is_final === true,
            confidence: alternative.confidence || 0,
            speechFinal: data.speech_final === true,
          };

          this.emit("transcript", event);

          if (event.isFinal) {
            logger.debug(`[STT] Final: "${text}" (confidence: ${event.confidence.toFixed(2)})`);
          }
          break;
        }

        case "UtteranceEnd": {
          this.emit("utterance_end");
          break;
        }

        case "SpeechStarted": {
          this.emit("speech_started");
          break;
        }
      }
    });

    this.socket.on("close", () => {
      this.isConnected = false;
      if (this.keepAliveInterval) {
        clearInterval(this.keepAliveInterval);
        this.keepAliveInterval = null;
      }

      if (this.intentionalClose) {
        logger.info("[STT] Deepgram connection closed (intentional)");
        this.emit("close");
      } else {
        logger.warn("[STT] Deepgram connection dropped unexpectedly");
        this.attemptReconnect();
      }
    });

    this.socket.on("error", (err: any) => {
      logger.error("[STT] Deepgram error:", err.message || err);
      this.emit("error", err);
    });

    // Wait for the socket to be open
    await this.socket.waitForOpen();
    this.isConnected = true;
    logger.info("[STT] Deepgram connection ready");
  }

  /**
   * Attempt to reconnect after an unexpected disconnection.
   * Uses exponential backoff: 500ms, 1000ms, 2000ms.
   */
  private attemptReconnect(): void {
    if (this.intentionalClose || this.isReconnecting) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logger.error(`[STT] Reconnection failed after ${MAX_RECONNECT_ATTEMPTS} attempts`);
      this.emit("reconnect_failed");
      this.emit("close");
      return;
    }

    this.isReconnecting = true;
    const delay = RECONNECT_DELAYS[this.reconnectAttempts] || 2000;
    this.reconnectAttempts++;

    logger.info(`[STT] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

    setTimeout(async () => {
      if (this.intentionalClose) {
        this.isReconnecting = false;
        return;
      }

      const apiKey = this.options.apiKey || process.env.DEEPGRAM_API_KEY;
      if (!apiKey) {
        this.isReconnecting = false;
        return;
      }

      try {
        await this.establishConnection(apiKey);
        this.isReconnecting = false;
        logger.info("[STT] Reconnected to Deepgram successfully");
        this.emit("reconnected");
      } catch (err: any) {
        this.isReconnecting = false;
        logger.error(`[STT] Reconnect attempt ${this.reconnectAttempts} failed:`, err.message);
        this.attemptReconnect(); // Try next attempt
      }
    }, delay);
  }

  /**
   * Send raw audio data to Deepgram for transcription
   * @param audioData - Raw mulaw audio buffer (from Telnyx)
   */
  sendAudio(audioData: Buffer): void {
    if (!this.isConnected) return;

    // Simulation mode — no Deepgram connection
    if (!this.socket) return;

    try {
      this.socket.sendMedia(audioData);
    } catch (err: any) {
      logger.error("[STT] Failed to send audio:", err.message);
    }
  }

  /**
   * Close the Deepgram connection (intentional — no reconnect)
   */
  close(): void {
    this.intentionalClose = true;

    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }

    if (this.socket && this.isConnected) {
      try {
        this.socket.close();
      } catch {
        // ignore close errors
      }
    }

    this.isConnected = false;
    this.socket = null;
    this.removeAllListeners();
  }

  get connected(): boolean {
    return this.isConnected;
  }
}
