/**
 * llm-service.ts — Optional Groq Llama 3.1 8B fallback for ambiguous regex results.
 * Only called when regex returns "general_question" on long transcripts.
 * Cost: <$0.50/month per clinic.
 */

import logger from "../lib/logger";

interface LLMEnhancement {
  intent: string | null;
  patient: {
    name: string | null;
    phone: string | null;
  } | null;
}

/**
 * Reclassify intent + extract patient info using Groq Llama 3.1 8B.
 * Returns null fields when LLM cannot determine a better classification.
 */
export async function enhanceWithLLM(params: {
  transcript: string;
  regexIntent: string;
  regexPatientName: string | null;
}): Promise<LLMEnhancement> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { intent: null, patient: null };

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content: `You are a dental receptionist call classifier. Given a call transcript, output JSON with:
- "intent": one of "book_appointment", "reschedule_appointment", "cancel_appointment", "emergency", "general_question"
- "patient_name": the caller's name if mentioned, or null
- "patient_phone": the caller's phone if mentioned, or null

Only output the JSON object, nothing else.`,
          },
          {
            role: "user",
            content: `Classify this dental clinic call transcript:\n\n${params.transcript.slice(0, 2000)}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 150,
      }),
    });

    if (!response.ok) {
      logger.error(`[LLM] Groq API error: ${response.status} ${response.statusText}`);
      return { intent: null, patient: null };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return { intent: null, patient: null };

    // Parse JSON response
    const parsed = JSON.parse(content);

    const validIntents = [
      "book_appointment",
      "reschedule_appointment",
      "cancel_appointment",
      "emergency",
      "general_question",
    ];

    const intent = validIntents.includes(parsed.intent) ? parsed.intent : null;

    const patient =
      parsed.patient_name || parsed.patient_phone
        ? { name: parsed.patient_name || null, phone: parsed.patient_phone || null }
        : null;

    logger.info(`[LLM] Groq reclassified: ${params.regexIntent} -> ${intent || "(no change)"}`);

    return { intent, patient };
  } catch (err: any) {
    logger.error(`[LLM] Groq enhancement failed: ${err.message}`);
    return { intent: null, patient: null };
  }
}
