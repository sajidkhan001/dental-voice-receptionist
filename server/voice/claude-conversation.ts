/**
 * claude-conversation.ts — Streaming conversation manager using Claude
 *
 * Maintains per-call conversation state, sends user speech to Claude,
 * streams response text for TTS, and handles tool calls (calendar, booking).
 */

import Anthropic from "@anthropic-ai/sdk";
import { EventEmitter } from "events";
import { ClinicConfig } from "../lib/types";
import { buildVoicePrompt, getVoiceTools } from "./prompt-builder";
import { withRetry } from "./retry";
import logger from "../lib/logger";

type Message = Anthropic.MessageParam;
type ContentBlock = Anthropic.ContentBlock;
type ToolUseBlock = Anthropic.ToolUseBlock;

export interface ToolCall {
  name: string;
  input: Record<string, any>;
  id: string;
}

// Compliance filter: banned phrases that indicate medical advice/diagnosis/treatment.
// If detected, replace the entire sentence with a safe redirect.
const COMPLIANCE_BANNED_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Diagnosis patterns
  { pattern: /\b(sounds like|looks like|seems like|appears to be|probably|likely|could be)\s+(a |an )?(cavity|abscess|infection|gum disease|gingivitis|periodontitis|TMJ|bruxism|impacted|fracture)/i,
    replacement: "I want to make sure you get accurate information — our clinical team would be the best ones to evaluate that." },
  // Treatment recommendations
  { pattern: /\b(you (should|need to|might need|probably need)|I('d| would) recommend)\s+(get |have |a )?(root canal|extraction|filling|crown|implant|antibiotics|surgery|x-ray|cleaning)/i,
    replacement: "Our doctor can give you the best recommendation after an evaluation. Would you like me to schedule an appointment?" },
  // Price quoting
  { pattern: /\b(costs?|prices?|fees?|charges?)\s*(is|are|will be|would be|about|around|approximately)\s*\$?\d/i,
    replacement: "Our team will confirm costs when we verify your insurance. Would you like to schedule a visit?" },
  // Medication advice
  { pattern: /\b(take|use|try)\s+(ibuprofen|tylenol|advil|motrin|aspirin|amoxicillin|penicillin|antibiotics|orajel|pain ?killers?)/i,
    replacement: "I'm not able to give medication advice, but our doctor can help with that at your appointment." },
];

const COMPLIANCE_SAFE_REDIRECT = "I want to make sure you get accurate information — our clinical team would be the best ones to evaluate that. Would you like me to schedule an appointment?";

export class ClaudeConversation extends EventEmitter {
  private client: Anthropic | null = null;
  private messages: Message[] = [];
  private systemPrompt: string;
  private tools: ReturnType<typeof getVoiceTools>;
  private isProcessing = false;
  private abortController: AbortController | null = null;
  private clinicConfig: ClinicConfig;

  private language: string;

  constructor(clinic: ClinicConfig, language: string = "en", apiKey?: string | null) {
    super();
    this.clinicConfig = clinic;
    this.language = language;
    this.systemPrompt = buildVoicePrompt(clinic, language);
    this.tools = getVoiceTools();

    const effectiveApiKey = apiKey || process.env.ANTHROPIC_API_KEY;
    if (effectiveApiKey) {
      this.client = new Anthropic({ apiKey: effectiveApiKey });
    } else {
      logger.warn("[LLM] No ANTHROPIC_API_KEY — running in simulation mode");
    }
  }

  /**
   * Compliance guardian: filter AI responses for medical advice, diagnosis,
   * treatment recommendations, and price quotes before they reach TTS.
   * Returns the filtered text, or a safe redirect if a violation is found.
   */
  private filterCompliance(text: string): string {
    for (const { pattern, replacement } of COMPLIANCE_BANNED_PATTERNS) {
      if (pattern.test(text)) {
        logger.warn(`[COMPLIANCE] Blocked violation in: "${text.slice(0, 80)}..."`);
        return replacement;
      }
    }
    return text;
  }

  /**
   * Emit text with compliance filtering applied.
   * All AI response text MUST go through this method, never raw emit("text").
   */
  private emitFilteredText(text: string): void {
    const filtered = this.filterCompliance(text);
    this.emit("text", filtered);
  }

  /**
   * Send user speech text to Claude and stream the response.
   * Emits "text" events for each response chunk (for TTS),
   * "tool_call" events when Claude wants to use a tool,
   * and "response_end" when the full response is complete.
   */
  async processUserSpeech(userText: string): Promise<void> {
    if (this.isProcessing) {
      logger.warn("[LLM] Already processing — queuing will be handled by caller");
      return;
    }

    this.isProcessing = true;
    this.messages.push({ role: "user", content: userText });

    // Simulation mode
    if (!this.client) {
      await this.simulateResponse(userText);
      this.isProcessing = false;
      return;
    }

    try {
      await withRetry(() => this.streamResponse(), {
        maxRetries: 2,
        baseDelayMs: 200,
        label: "Claude LLM",
      });
    } catch (err: any) {
      if (err.name === "AbortError") {
        logger.info("[LLM] Response aborted (interruption)");
      } else {
        logger.error("[LLM] Claude API error (after retries):", err.message);
        this.emitFilteredText("I'm sorry, I'm having a technical issue. Let me transfer you to our front desk team.");
        this.emit("tool_call", { name: "transfer_call", input: { reason: "technical_error", department: "front_desk" }, id: "err" } as ToolCall);
      }
    } finally {
      this.isProcessing = false;
      this.abortController = null;
    }
  }

  /**
   * Trim conversation history to prevent context window overflow.
   * Keeps first 2 messages (greeting context) + last 10 message pairs.
   * Called before each Claude request to ensure bounded memory.
   */
  private trimMessages(): void {
    const MAX_ESTIMATED_TOKENS = 8000;
    const estimatedTokens = this.messages.reduce((sum, m) => {
      const content = typeof m.content === "string"
        ? m.content
        : JSON.stringify(m.content);
      return sum + Math.ceil(content.length / 4);
    }, 0);

    if (estimatedTokens <= MAX_ESTIMATED_TOKENS || this.messages.length <= 12) {
      return;
    }

    // Keep first 2 messages (greeting/context) + last 10 messages
    const head = this.messages.slice(0, 2);
    const tail = this.messages.slice(-10);

    // Build a brief summary of trimmed messages for continuity
    const trimmedCount = this.messages.length - 12;
    const summaryMsg: Message = {
      role: "user",
      content: `[System note: ${trimmedCount} earlier messages trimmed for context. The conversation has been ongoing. Continue naturally.]`,
    };

    this.messages = [...head, summaryMsg, ...tail];
    logger.info(`[LLM] Trimmed ${trimmedCount} messages (estimated ${estimatedTokens} tokens → ~${Math.ceil(this.messages.reduce((s, m) => s + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length), 0) / 4)})`);
  }

  /**
   * Stream a response from Claude, handling text and tool use
   */
  private async streamResponse(): Promise<void> {
    this.trimMessages();
    this.abortController = new AbortController();

    const stream = this.client!.messages.stream({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: [
        {
          type: "text" as const,
          text: this.systemPrompt,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      messages: this.messages,
      tools: this.tools,
    }, { signal: this.abortController.signal });

    let fullText = "";
    let clauseBuffer = "";
    let isFirstChunk = true;
    const toolCalls: ToolCall[] = [];

    stream.on("text", (text: string) => {
      fullText += text;
      clauseBuffer += text;

      // Emit "first_token" for latency tracking
      if (isFirstChunk) {
        isFirstChunk = false;
        this.emit("first_token");
      }

      // Clause-level chunking: emit text at natural speech pauses, not just sentence ends.
      // This reduces time-to-first-audio by 200-400ms vs waiting for full sentences.
      //
      // Strategy:
      //   - First chunk: emit after ~20 chars or any pause marker (get audio playing ASAP)
      //   - Subsequent chunks: emit at commas, semicolons, colons, dashes, or sentence ends
      //   - Fallback: emit if buffer exceeds 80 chars (prevents long unpunctuated runs)

      const FIRST_CHUNK_MIN = 20;
      const SUBSEQUENT_CHUNK_MIN = 40;
      const MAX_BUFFER = 80;

      const minChars = fullText.length <= clauseBuffer.length + 5 ? FIRST_CHUNK_MIN : SUBSEQUENT_CHUNK_MIN;

      // Split on clause boundaries: sentence enders AND pause markers
      const clauseSplit = /([.!?](?:\s|$)|[,;:—–]\s)/;
      const parts = clauseBuffer.split(clauseSplit);

      // Process complete clauses (pairs of [text, delimiter])
      while (parts.length >= 3) {
        const clause = parts.shift()! + parts.shift()!;
        if (clause.trim() && clause.trim().length >= minChars) {
          this.emitFilteredText(clause.trim());
          clauseBuffer = parts.join("");
        } else if (parts.length >= 3) {
          // Clause too short — merge with next clause
          parts[0] = clause + parts[0];
        } else {
          // Put it back, not enough to emit
          clauseBuffer = clause + parts.join("");
          break;
        }
      }

      if (parts.length < 3) {
        clauseBuffer = parts.join("");
      }

      // Fallback: emit if buffer is getting too long (no punctuation)
      if (clauseBuffer.length >= MAX_BUFFER) {
        // Find last space to avoid cutting mid-word
        const lastSpace = clauseBuffer.lastIndexOf(" ", MAX_BUFFER);
        if (lastSpace > minChars) {
          this.emitFilteredText(clauseBuffer.slice(0, lastSpace).trim());
          clauseBuffer = clauseBuffer.slice(lastSpace);
        }
      }
    });

    const finalMessage = await stream.finalMessage();

    // Emit any remaining text (with compliance filter)
    if (clauseBuffer.trim()) {
      this.emitFilteredText(clauseBuffer.trim());
    }

    // Process tool calls from the response
    for (const block of finalMessage.content) {
      if (block.type === "tool_use") {
        const toolCall: ToolCall = {
          name: block.name,
          input: block.input as Record<string, any>,
          id: block.id,
        };
        toolCalls.push(toolCall);
        this.emit("tool_call", toolCall);
      }
    }

    // Save assistant message to history
    this.messages.push({ role: "assistant", content: finalMessage.content });

    // If there were tool calls, we need to provide results and get Claude's follow-up
    if (toolCalls.length > 0) {
      this.emit("response_end", { text: fullText, hasToolCalls: true });
    } else {
      this.emit("response_end", { text: fullText, hasToolCalls: false });
    }
  }

  /**
   * Provide tool results back to Claude and get the follow-up response
   */
  async provideToolResult(toolId: string, result: any): Promise<void> {
    this.messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolId,
          content: typeof result === "string" ? result : JSON.stringify(result),
        },
      ],
    });

    this.isProcessing = true;
    try {
      await this.streamResponse();
    } catch (err: any) {
      logger.error("[LLM] Tool result follow-up error:", err.message);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Interrupt the current response (caller started speaking)
   */
  interrupt(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Simulation mode response
   */
  private async simulateResponse(userText: string): Promise<void> {
    const lower = userText.toLowerCase();
    let response: string;

    if (this.messages.length <= 1) {
      response = `Thank you for calling ${this.clinicConfig.name}, this is your AI receptionist. How can I help you today?`;
    } else if (lower.includes("book") || lower.includes("appointment") || lower.includes("schedule")) {
      response = "I'd be happy to help you schedule an appointment. Could I get your name please?";
    } else if (lower.includes("emergency") || lower.includes("pain")) {
      response = "I can hear this is urgent. I'm connecting you with our on-call team right away.";
      this.emit("tool_call", {
        name: "transfer_call",
        input: { reason: "emergency", department: "emergency" },
        id: "sim-transfer",
      } as ToolCall);
    } else {
      response = "I'd be happy to help you with that. Is there anything specific you'd like to know?";
    }

    // Simulate streaming delay
    await new Promise((r) => setTimeout(r, 100));
    this.emitFilteredText(response);

    this.messages.push({ role: "assistant", content: response });
    this.emit("response_end", { text: response, hasToolCalls: false });
  }

  /**
   * Switch language mid-call. Rebuilds system prompt with new language instruction.
   * Called when language-detector identifies a non-English speaker.
   */
  updateLanguage(language: string): void {
    this.language = language;
    this.systemPrompt = buildVoicePrompt(this.clinicConfig, language);
    logger.info(`[LLM] Language switched to ${language} — system prompt rebuilt`);
  }

  /**
   * Get the full conversation transcript
   */
  getTranscript(): string {
    return this.messages
      .filter((m) => typeof m.content === "string")
      .map((m) => `${m.role === "user" ? "CALLER" : "AI"}: ${m.content}`)
      .join("\n");
  }

  /**
   * Get structured messages for pipeline processing
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * Clean up
   */
  destroy(): void {
    this.interrupt();
    this.removeAllListeners();
    this.messages = [];
  }

  get processing(): boolean {
    return this.isProcessing;
  }
}
