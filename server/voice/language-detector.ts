/**
 * language-detector.ts — Detect caller language from initial speech
 *
 * Uses Deepgram's built-in language detection or inference from
 * early transcript content. Supports switching the entire pipeline
 * (STT, TTS, Claude prompt) to the detected language.
 */

import logger from "../lib/logger";

export type SupportedLanguage = "en" | "es" | "fr" | "pt" | "zh" | "ko" | "vi" | "ar";

const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  pt: "Portuguese",
  zh: "Chinese",
  ko: "Korean",
  vi: "Vietnamese",
  ar: "Arabic",
};

// Language indicator phrases — common words/phrases that identify the caller's language.
// Each array has 10-15 common dental/phone context words.
// A single match is enough for high-confidence languages (Spanish, French).

const LANGUAGE_INDICATORS: Record<SupportedLanguage, string[]> = {
  en: [], // English is the default — no detection needed
  es: [
    "hola", "buenos", "buenas", "necesito", "quiero", "cita", "dentista",
    "limpieza", "dolor", "muela", "diente", "por favor", "gracias",
    "habla espanol", "habla español", "no hablo ingles", "no hablo inglés",
    "en español", "puede hablar", "ayuda", "emergencia", "urgente",
  ],
  fr: [
    "bonjour", "bonsoir", "rendez-vous", "dentiste", "nettoyage", "douleur",
    "s'il vous plaît", "merci", "parlez-vous français", "je ne parle pas anglais",
    "en français", "j'ai besoin", "je voudrais", "urgence", "mal aux dents",
  ],
  pt: [
    "olá", "bom dia", "boa tarde", "dentista", "consulta", "limpeza",
    "dor", "dente", "por favor", "obrigado", "obrigada", "preciso",
    "fala português", "não falo inglês", "em português", "emergência",
  ],
  zh: [
    "你好", "牙医", "预约", "牙齿", "疼痛", "清洁", "谢谢",
    "我需要", "不会说英语", "说中文", "急诊", "帮助",
  ],
  ko: [
    "안녕하세요", "치과", "예약", "치아", "아파", "청소", "감사합니다",
    "도와주세요", "영어 못해요", "한국어", "긴급",
  ],
  vi: [
    "xin chào", "nha khoa", "đặt lịch", "răng", "đau", "làm sạch",
    "cảm ơn", "giúp tôi", "không nói tiếng anh", "tiếng việt", "khẩn cấp",
  ],
  ar: [
    "مرحبا", "السلام عليكم", "طبيب أسنان", "موعد", "ألم", "تنظيف",
    "شكرا", "ساعدني", "لا أتكلم إنجليزي", "بالعربي", "طوارئ",
  ],
};

/**
 * Detect language from transcript text using keyword matching.
 * Returns detected language or null if unclear.
 * Checks all supported languages and returns the one with the most matches.
 */
export function detectLanguageFromText(text: string): SupportedLanguage | null {
  if (!text || text.length < 3) return null;

  const lower = text.toLowerCase().trim();

  let bestLang: SupportedLanguage | null = null;
  let bestScore = 0;

  for (const [lang, indicators] of Object.entries(LANGUAGE_INDICATORS) as [SupportedLanguage, string[]][]) {
    if (lang === "en" || indicators.length === 0) continue;
    const score = indicators.filter((word) => lower.includes(word)).length;
    if (score > bestScore) {
      bestScore = score;
      bestLang = lang;
    }
  }

  // At least 1 match needed for detection
  if (bestScore >= 1) return bestLang;

  // Default: assume English (or null if truly unclear)
  return null;
}

/**
 * Get Deepgram language code for a supported language.
 */
export function getDeepgramLanguage(lang: SupportedLanguage): string {
  const map: Record<SupportedLanguage, string> = {
    en: "en-US",
    es: "es",
    fr: "fr",
    pt: "pt-BR",
    zh: "zh-CN",
    ko: "ko",
    vi: "vi",
    ar: "ar",
  };
  return map[lang] || "en-US";
}

/**
 * Get Inworld TTS voice ID for a supported language.
 * Inworld TTS-1.5 Max is multilingual — voice selection determines language accent.
 * Override per-language voices via env vars: INWORLD_VOICE_ES, INWORLD_VOICE_FR, etc.
 */
export function getInworldVoiceId(lang: SupportedLanguage): string {
  const voices: Record<SupportedLanguage, string> = {
    en: process.env.INWORLD_VOICE_ID || "Ashley",       // Warm, professional (English)
    es: process.env.INWORLD_VOICE_ES || "Ashley",       // Inworld handles Spanish natively
    fr: process.env.INWORLD_VOICE_FR || "Ashley",
    pt: process.env.INWORLD_VOICE_PT || "Ashley",
    zh: process.env.INWORLD_VOICE_ZH || "Ashley",
    ko: process.env.INWORLD_VOICE_KO || "Ashley",
    vi: process.env.INWORLD_VOICE_VI || "Ashley",
    ar: process.env.INWORLD_VOICE_AR || "Ashley",
  };
  return voices[lang] || voices.en;
}

/**
 * Get Inworld TTS model ID for a language.
 * Inworld TTS-1.5 Max supports multilingual natively — same model for all languages.
 */
export function getInworldModelId(_lang: SupportedLanguage): string {
  return process.env.INWORLD_MODEL_ID || "inworld-tts-1.5-max";
}

/**
 * Get language display name.
 */
export function getLanguageName(lang: SupportedLanguage): string {
  return LANGUAGE_NAMES[lang] || "English";
}

/**
 * Check if a language is supported by the clinic.
 */
export function isLanguageSupported(lang: SupportedLanguage, supportedLanguages: string[]): boolean {
  if (!supportedLanguages || supportedLanguages.length === 0) return lang === "en";
  return supportedLanguages.includes(lang);
}
