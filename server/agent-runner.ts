import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import {
  ClinicConfig,
  CallData,
  PatientInfo,
  SlotOffer,
  PipelineResult,
  ProviderConfig,
  ServiceConfig,
} from "./lib/types";
import { saveCallLog } from "./services/call-service";
import { createBooking as saveBookingRecord } from "./services/booking-service";
import { saveNotification } from "./services/notification-service";
import { auditLog } from "./services/audit-service";
import logger from "./lib/logger";

// ---- Claude-powered transcript analysis (replaces regex Steps 1-3) ----

interface ClaudeAnalysis {
  crisis: { is_crisis: boolean; reason: string | null };
  patient: PatientInfo | null;
  intent: string;
  service_detected: string;
  sentiment: string;
  summary: string;
}

async function analyzeTranscriptWithClaude(
  transcript: string,
  clinic: ClinicConfig
): Promise<ClaudeAnalysis | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const serviceList = clinic.services.map((s) => `${s.slug} (${s.name})`).join(", ");

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: [
        {
          type: "text" as const,
          text: `You are a dental clinic call transcript analyzer. Return ONLY valid JSON (no markdown, no explanation). Crisis triggers: pain rated 7+/10, facial/neck swelling, uncontrolled bleeding, tooth knocked out, difficulty breathing/swallowing, child dental emergency, suspected abscess/infection.`,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      messages: [
        {
          role: "user",
          content: `Analyze this dental clinic call transcript.

Transcript:
"""
${transcript}
"""

Available services: ${serviceList}

Return this exact JSON structure:
{
  "crisis": { "is_crisis": boolean, "reason": string or null },
  "patient": { "name": string or null, "phone": string or null, "email": string or null, "insurance": string or null, "is_new_patient": boolean, "age_note": string or null } or null,
  "intent": one of "book_appointment", "reschedule_appointment", "cancel_appointment", "emergency", "general_question",
  "service_detected": service slug from the list above or "exam" if unclear,
  "sentiment": one of "positive", "neutral", "negative", "frustrated",
  "summary": 1-2 sentence summary of the call
}`,
        },
      ],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    // Parse JSON — handle potential markdown wrapping
    const jsonStr = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    const parsed = JSON.parse(jsonStr) as ClaudeAnalysis;

    // Validate required fields
    if (!parsed.crisis || !parsed.intent) {
      logger.warn("[PIPELINE] Claude analysis returned invalid structure, falling back to regex");
      return null;
    }

    // Normalize patient to our PatientInfo format
    if (parsed.patient) {
      parsed.patient = {
        name: parsed.patient.name || null,
        phone: parsed.patient.phone || null,
        email: parsed.patient.email || null,
        insurance: parsed.patient.insurance || null,
        is_new_patient: parsed.patient.is_new_patient || false,
        age_note: parsed.patient.age_note || null,
      };
    }

    return parsed;
  } catch (err: any) {
    logger.warn(`[PIPELINE] Claude analysis failed: ${err.message}, falling back to regex`);
    return null;
  }
}

// ============================================================
// Agent Pipeline Runner — Multi-Tenant
//
// SIMULATION MODE: Runs the full pipeline logic locally using
// mock data. No external API calls. Falls back to this when
// no ClinicConfig is provided or SIMULATION_MODE is set.
//
// PRODUCTION MODE: Uses real Google Calendar API via per-clinic
// OAuth credentials. Logs to PostgreSQL.
// ============================================================

const SIMULATION = process.env.SIMULATION_MODE !== "false";
const LOG_DIR = path.resolve(__dirname, "../logs");

function ensureLogDirs() {
  for (const sub of ["calls", "sms", "email", "bookings", "escalations"]) {
    const dir = path.join(LOG_DIR, sub);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

// ---- STEP 1: Crisis Detection (crisis-detector agent) ----
export function detectCrisis(transcript: string): { is_crisis: boolean; reason: string | null } {
  const lower = transcript.toLowerCase();
  const triggers = [
    { pattern: /pain\s*(?:level|rating|at|of|is)?\s*(?:a\s*)?([7-9]|10)/i, reason: "Pain level 7+" },
    { pattern: /swelling|swollen/i, reason: "Swelling reported" },
    { pattern: /bleeding.*(?:won't|doesn't|not)\s*stop/i, reason: "Uncontrolled bleeding" },
    { pattern: /knocked\s*out|avuls/i, reason: "Tooth avulsion" },
    { pattern: /can't\s*breathe|trouble\s*breathing|difficulty\s*swallowing/i, reason: "Breathing/swallowing difficulty" },
    { pattern: /fever|temperature/i, reason: "Fever reported" },
    { pattern: /bad\s*taste|pus|abscess/i, reason: "Possible infection/abscess" },
  ];

  for (const { pattern, reason } of triggers) {
    if (pattern.test(lower)) {
      return { is_crisis: true, reason };
    }
  }

  if (/pain/i.test(lower) && /\b([8-9]|10)\b/.test(lower)) {
    return { is_crisis: true, reason: "High pain level detected" };
  }

  return { is_crisis: false, reason: null };
}

// ---- STEP 2: Patient Qualification (patient-qualifier agent) ----
export function extractPatientInfo(transcript: string): PatientInfo | null {
  const nameMatch = transcript.match(
    /(?:my name is|name's|i am|this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i
  );
  const phoneMatch = transcript.match(
    /(\d{3}[-.\s]?\d{3}[-.\s]?\d{4}|\+\d{10,11})/
  );
  const emailMatch = transcript.match(
    /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/
  );
  const insuranceMatch = transcript.match(
    /(?:have|with|using|my insurance is)\s+(delta\s*dental|metlife|cigna|aetna|united|guardian|humana|blue\s*cross)[^.]*/i
  );

  const isNew =
    /first\s*(?:time|visit)|new\s*patient|never\s*been/i.test(transcript);

  const ageMatch = transcript.match(
    /(?:she's|he's|they're|child is|daughter is|son is)\s+(\d+)\s*(?:years?\s*old|yr)/i
  );

  if (!nameMatch && !phoneMatch) return null;

  return {
    name: nameMatch ? nameMatch[1].trim() : "Unknown",
    phone: phoneMatch ? phoneMatch[1].replace(/[-.\s]/g, "") : "unknown",
    email: emailMatch ? emailMatch[1] : null,
    insurance: insuranceMatch ? insuranceMatch[1].trim() : null,
    is_new_patient: isNew,
    age_note: ageMatch ? `Patient/child is ${ageMatch[1]} years old` : null,
  };
}

// ---- STEP 3: Intent Classification (intent-classifier agent) ----
export function classifyIntent(transcript: string): string {
  const lower = transcript.toLowerCase();

  if (/cancel/i.test(lower)) return "cancel_appointment";
  if (/reschedule|move|change.*appointment|different\s*(?:time|day|date)/i.test(lower))
    return "reschedule_appointment";
  if (/emergency|urgent|pain|hurt|swelling|bleeding/i.test(lower))
    return "emergency";
  if (/schedule|book/i.test(lower))
    return "book_appointment";
  if (
    /how\s*much|cost|price|insurance|accept|do\s*you\s*(?:do|offer|have)|are\s*you\s*open/i.test(lower)
  )
    return "general_question";
  if (
    /appointment|cleaning|checkup|come\s*in|get\s*in/i.test(lower)
  )
    return "book_appointment";
  if (/emergency|urgent|pain|hurt|swelling|bleeding/i.test(lower))
    return "emergency";

  return "general_question";
}

// ---- Transcript parsing helpers ----
function detectService(transcript: string, services: ServiceConfig[]): string {
  const lower = transcript.toLowerCase();
  // Check against clinic's actual service slugs via keyword matching
  const keywords: Record<string, RegExp> = {
    cleaning: /cleaning/i,
    filling: /filling/i,
    ortho_consult: /invisalign|ortho|braces/i,
    pediatric_exam: /pediatric|child|kid|daughter|son/i,
    whitening_consult: /whitening/i,
    root_canal: /root\s*canal/i,
    extraction: /extraction/i,
    implant_consult: /implant/i,
    emergency: /emergency|urgent/i,
  };

  for (const svc of services) {
    const kw = keywords[svc.slug];
    if (kw && kw.test(lower)) return svc.slug;
  }

  // Fallback: still check default keywords for backward compatibility
  for (const [slug, pattern] of Object.entries(keywords)) {
    if (pattern.test(lower)) return slug;
  }

  return "exam";
}

function matchProvider(service: string, providers: ProviderConfig[], services: ServiceConfig[]): string {
  // First: check if the service has a default provider assigned
  const svc = services.find((s) => s.slug === service);
  if (svc?.defaultProviderId) {
    const provider = providers.find((p) => p.id === svc.defaultProviderId);
    if (provider) return provider.name;
  }

  // Second: match by specialty keywords
  const specialtyMap: Record<string, RegExp> = {
    ortho_consult: /ortho/i,
    pediatric_exam: /pediatric|pedi/i,
    cleaning: /hygien/i,
  };

  const pattern = specialtyMap[service];
  if (pattern) {
    const match = providers.find(
      (p) => (p.specialty && pattern.test(p.specialty)) || (p.title && pattern.test(p.title))
    );
    if (match) return match.name;
  }

  // Fallback: first provider or "General Dentist"
  const general = providers.find((p) => p.specialty && /general/i.test(p.specialty));
  return general?.name || providers[0]?.name || "Doctor";
}

function extractDayPrefs(transcript: string): { days: string[]; afternoon: boolean } {
  const lower = transcript.toLowerCase();
  const days: string[] = [];
  if (/monday/i.test(lower)) days.push("Monday");
  if (/tuesday/i.test(lower)) days.push("Tuesday");
  if (/wednesday/i.test(lower)) days.push("Wednesday");
  if (/thursday/i.test(lower)) days.push("Thursday");
  if (/friday/i.test(lower)) days.push("Friday");
  if (/saturday/i.test(lower)) days.push("Saturday");
  const afternoon = /afternoon|after\s*(?:school|work|lunch)|[3-5]\s*(?:pm|PM)|after\s*\d/i.test(lower);
  return { days, afternoon };
}

function getServiceDuration(serviceSlug: string, services: ServiceConfig[]): number {
  const svc = services.find((s) => s.slug === serviceSlug);
  return svc?.durationMinutes || 60;
}

// ---- STEP 4: Calendar Check + Slot Proposal ----
async function findAvailableSlots(
  intent: string,
  transcript: string,
  clinic: ClinicConfig
): Promise<SlotOffer[]> {
  if (intent !== "book_appointment" && intent !== "reschedule_appointment") {
    return [];
  }

  const service = detectService(transcript, clinic.services);
  const provider = matchProvider(service, clinic.providers, clinic.services);
  const prefs = extractDayPrefs(transcript);

  // PRODUCTION: Use real Google Calendar with per-clinic OAuth
  if (!SIMULATION && clinic.googleAuth) {
    try {
      const { findRealAvailableSlots } = await import("./lib/calendar-manager");
      logger.info(`  >> [CALENDAR] Querying real Google Calendar for ${provider} (${clinic.name})...`);
      const slots = await findRealAvailableSlots(
        clinic,
        service,
        provider,
        prefs.days.length > 0 ? prefs.days : undefined,
        prefs.afternoon || undefined
      );
      return slots;
    } catch (err: any) {
      logger.error(`  >> [CALENDAR] Google Calendar error: ${err.message}`);
      logger.info("  >> Falling back to simulation slots");
    }
  }

  // SIMULATION: Return mock slots with dynamic dates
  const slots: SlotOffer[] = [];
  const wantsWednesday = /wednesday/i.test(transcript.toLowerCase());
  const wantsFriday = /friday/i.test(transcript.toLowerCase());

  const today = new Date();
  const nextWed = new Date(today);
  nextWed.setDate(today.getDate() + ((3 - today.getDay() + 7) % 7 || 7));
  const nextFri = new Date(today);
  nextFri.setDate(today.getDate() + ((5 - today.getDay() + 7) % 7 || 7));
  const nextTue = new Date(today);
  nextTue.setDate(today.getDate() + ((2 - today.getDay() + 7) % 7 || 7));

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const dayName = (d: Date) => d.toLocaleDateString("en-US", { weekday: "long" });

  if (wantsWednesday) {
    slots.push(
      { provider, date: fmt(nextWed), day: "Wednesday", time: prefs.afternoon ? "3:00 PM" : "11:15 AM", service },
      { provider, date: fmt(nextWed), day: "Wednesday", time: prefs.afternoon ? "4:00 PM" : "1:00 PM", service }
    );
  }
  if (wantsFriday) {
    slots.push(
      { provider, date: fmt(nextFri), day: "Friday", time: prefs.afternoon ? "3:00 PM" : "10:15 AM", service },
      { provider, date: fmt(nextFri), day: "Friday", time: prefs.afternoon ? "4:00 PM" : "1:00 PM", service }
    );
  }
  if (slots.length === 0) {
    slots.push(
      { provider, date: fmt(nextTue), day: dayName(nextTue), time: "10:45 AM", service },
      { provider, date: fmt(nextTue), day: dayName(nextTue), time: "3:15 PM", service },
      { provider, date: fmt(nextWed), day: dayName(nextWed), time: "1:00 PM", service }
    );
  }
  return slots;
}

// ---- STEP 5: Generate Agent Response ----
function generateResponse(
  intent: string,
  crisis: { is_crisis: boolean; reason: string | null },
  patient: PatientInfo | null,
  slots: SlotOffer[],
  clinic: ClinicConfig
): string {
  const clinicName = clinic.name;
  const clinicPhone = clinic.phone || "our main line";

  if (crisis.is_crisis) {
    return `I can hear this is urgent, and I want to make sure you get help right away. I'm transferring you to our on-call dental team now. Please stay on the line. [TRANSFER TO: ${clinic.emergencyNumber || "emergency line"}]`;
  }

  switch (intent) {
    case "book_appointment":
      if (slots.length === 0) {
        return `Thank you for calling ${clinicName}. I'd love to help you schedule an appointment, but I need to check our availability. Could you call us during business hours at ${clinicPhone}? We'll find the perfect time for you.`;
      }
      const slotList = slots
        .slice(0, 3)
        .map((s, i) => `${i + 1}. ${s.day}, ${s.date} at ${s.time} with ${s.provider}`)
        .join("\n  ");
      const newPatientNote = patient?.is_new_patient
        ? " Since this would be your first visit, we'll set aside a little extra time to make sure you're comfortable. "
        : " ";
      return `I'd be happy to help you schedule an appointment at ${clinicName}.${newPatientNote}Here are some times that work:\n  ${slotList}\nWhich of these works best for you?`;

    case "reschedule_appointment":
      return `I can help you reschedule your appointment. Let me pull up your current booking and find some alternative times. One moment please. [CHECKING CALENDAR...]\n\nHere are some available times:\n  ${slots.map((s, i) => `${i + 1}. ${s.day}, ${s.date} at ${s.time}`).join("\n  ")}\n\nWould any of these work for you?`;

    case "cancel_appointment":
      return `I understand you need to cancel your appointment. I've taken care of that for you. If you'd like to reschedule in the future, you can call us anytime at ${clinicPhone}. Is there anything else I can help you with?`;

    case "general_question":
      return generateQuestionResponse(clinic);

    case "emergency":
      return `I understand you're in discomfort. Let me connect you with our clinical team right away so we can get you the help you need. Please hold for just a moment. [TRANSFER TO: emergency line]`;

    default:
      return `Thank you for calling ${clinicName}. How can I help you today?`;
  }
}

function generateQuestionResponse(clinic: ClinicConfig): string {
  const clinicName = clinic.name;
  // Build hours string from clinic config
  let hoursStr = "Monday through Friday, 9 AM to 6 PM";
  if (clinic.hours && Object.keys(clinic.hours).length > 0) {
    const parts: string[] = [];
    const dayMap: Record<string, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
    for (const [key, val] of Object.entries(clinic.hours)) {
      if (val) parts.push(`${dayMap[key] || key}: ${val.open} - ${val.close}`);
    }
    if (parts.length > 0) hoursStr = parts.join(", ");
  }

  return `Great questions! Here's what I can tell you about ${clinicName}:\n\n- Our hours are ${hoursStr}.\n- We accept most major dental insurance plans. Our team can verify your specific coverage when you come in.\n- We offer a full range of dental services. For specific pricing, I'd recommend scheduling a consultation.\n\nWould you like to schedule an appointment?`;
}

// ---- STEP 6: Send Notifications ----
async function sendNotifications(
  intent: string,
  patient: PatientInfo | null,
  slot: SlotOffer | null,
  clinic: ClinicConfig,
  callLogId?: string
): Promise<string[]> {
  const sent: string[] = [];
  const clinicName = clinic.name;
  const clinicPhone = clinic.phone || "our main line";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  if (intent === "book_appointment" && slot && patient) {
    // PRODUCTION: Create real Google Calendar event
    if (!SIMULATION && clinic.googleAuth) {
      try {
        const { createBooking: calCreateBooking, getDuration } = await import("./lib/calendar-manager");
        const event = await calCreateBooking(clinic, {
          summary: `${slot.service} - ${patient.name}`,
          provider: slot.provider,
          date: slot.date,
          startTime: slot.time,
          durationMinutes: getServiceDuration(slot.service, clinic.services),
          description: `Patient: ${patient.name}\nPhone: ${patient.phone}\nInsurance: ${patient.insurance || "N/A"}\nNew patient: ${patient.is_new_patient}\n\nBooked by AI Receptionist`,
        });
        sent.push(`Google Calendar event created: ${event.eventId}`);

        // Save booking to DB
        const providerId = clinic.providers.find((p) => p.name === slot.provider)?.id;
        const serviceId = clinic.services.find((s) => s.slug === slot.service)?.id;
        await saveBookingRecord(clinic.id, {
          callLogId,
          googleEventId: event.eventId,
          providerId: providerId || undefined,
          serviceId: serviceId || undefined,
          patientName: patient.name || "Unknown",
          patientPhone: patient.phone || undefined,
          patientEmail: patient.email || undefined,
          patientInsurance: patient.insurance || undefined,
          isNewPatient: patient.is_new_patient,
          appointmentDate: slot.date,
          startTime: slot.time,
          durationMinutes: getServiceDuration(slot.service, clinic.services),
        });
        sent.push("Booking saved to database");
      } catch (err: any) {
        logger.error(`  >> [CALENDAR] Failed to create event: ${err.message}`);
        sent.push(`Calendar booking FAILED: ${err.message}`);
      }
    }

    // SMS confirmation
    const smsBody = `Hi ${patient.name}! Your appointment at ${clinicName} is confirmed:\n\n${slot.day}, ${slot.date} at ${slot.time}\n${slot.provider}\n\nSee you soon!\n- ${clinicName}`;

    if (!SIMULATION && clinic.id) {
      // Save to DB
      await saveNotification(clinic.id, {
        callLogId,
        channel: "sms",
        recipient: patient.phone || "unknown",
        body: smsBody,
      });
      sent.push(`SMS confirmation saved`);
    } else {
      // Simulation: write to file
      ensureLogDirs();
      const smsFile = path.join(LOG_DIR, "sms", `${timestamp}_confirmation.txt`);
      fs.writeFileSync(smsFile, `TO: ${patient.phone}\nFROM: ${clinic.smsFromNumber || "+15550001111"}\nTIME: ${new Date().toISOString()}\n\n${smsBody}`);
      sent.push(`SMS confirmation -> ${smsFile}`);
    }

    // Email confirmation
    if (patient.email) {
      const emailBody = `Dear ${patient.name},\n\nYour appointment has been confirmed:\n\nDate: ${slot.day}, ${slot.date}\nTime: ${slot.time}\nProvider: ${slot.provider}\nService: ${slot.service}\n\nIf you need to reschedule, please call us at ${clinicPhone}.\n\nSee you soon!\n${clinicName}`;
      const emailSubject = `Your Appointment at ${clinicName} - ${slot.day}, ${slot.date} at ${slot.time}`;

      if (!SIMULATION && clinic.id) {
        await saveNotification(clinic.id, {
          callLogId,
          channel: "email",
          recipient: patient.email,
          subject: emailSubject,
          body: emailBody,
        });
        sent.push(`Email confirmation saved`);
      } else {
        ensureLogDirs();
        const emailFile = path.join(LOG_DIR, "email", `${timestamp}_confirmation.txt`);
        fs.writeFileSync(emailFile, `TO: ${patient.email}\nFROM: ${clinic.emailFrom || "appointments@dental.com"}\nSUBJECT: ${emailSubject}\n\n${emailBody}`);
        sent.push(`Email confirmation -> ${emailFile}`);
      }
    }

    // Simulation: local booking log
    if (SIMULATION) {
      ensureLogDirs();
      const bookingContent = JSON.stringify({
        event_id: `evt-${uuidv4().slice(0, 8)}`,
        summary: `${slot.service} - ${patient.name}`,
        provider: slot.provider,
        date: slot.date,
        start_time: slot.time,
        duration_minutes: getServiceDuration(slot.service, clinic.services),
        patient_name: patient.name,
        patient_phone: patient.phone,
        patient_email: patient.email,
        insurance: patient.insurance,
        is_new_patient: patient.is_new_patient,
        created_at: new Date().toISOString(),
      }, null, 2);
      const bookingFile = path.join(LOG_DIR, "bookings", `${timestamp}_booking.json`);
      fs.writeFileSync(bookingFile, bookingContent);
      sent.push(`Calendar booking -> ${bookingFile}`);
    }
  }

  if (intent === "cancel_appointment" && patient) {
    const cancelBody = `Hi ${patient.name}, your appointment at ${clinicName} has been cancelled.\n\nCall us anytime at ${clinicPhone} to reschedule.\n\n- ${clinicName}`;

    if (!SIMULATION && clinic.id) {
      await saveNotification(clinic.id, {
        callLogId,
        channel: "sms",
        recipient: patient.phone || "unknown",
        body: cancelBody,
      });
      sent.push("SMS cancellation saved");
    } else {
      ensureLogDirs();
      const smsFile = path.join(LOG_DIR, "sms", `${timestamp}_cancellation.txt`);
      fs.writeFileSync(smsFile, `TO: ${patient.phone}\nFROM: ${clinic.smsFromNumber || "+15550001111"}\nTIME: ${new Date().toISOString()}\n\n${cancelBody}`);
      sent.push(`SMS cancellation -> ${smsFile}`);
    }
  }

  return sent;
}

// ---- MAIN PIPELINE ----
export async function runAgentPipeline(
  callData: CallData,
  clinic?: ClinicConfig
): Promise<PipelineResult> {
  const startMs = Date.now();

  // Default clinic config for simulation/backward compat
  const effectiveClinic: ClinicConfig = clinic || {
    id: "simulation",
    slug: "simulation",
    name: process.env.CLINIC_NAME || "Demo Dental Clinic",
    phone: process.env.CLINIC_PHONE || "555-000-1234",
    address: null,
    website: null,
    timezone: "America/New_York",
    emergencyNumber: process.env.EMERGENCY_NUMBER || "emergency line",
    hours: {},
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
      { id: "sim-1", name: "Dr. Smith", title: "Dr.", specialty: "General Dentistry", workingDays: [1,2,3,4,5], startHour: 9, endHour: 18, lunchStart: 12, lunchEnd: 13, calendarColorId: "1", googleCalendarId: null },
      { id: "sim-2", name: "Dr. Lee", title: "Dr.", specialty: "Orthodontics", workingDays: [2,4,6], startHour: 9, endHour: 18, lunchStart: 12, lunchEnd: 13, calendarColorId: "4", googleCalendarId: null },
      { id: "sim-3", name: "Dr. Patel", title: "Dr.", specialty: "Pediatric Dentistry", workingDays: [3,5], startHour: 9, endHour: 18, lunchStart: 12, lunchEnd: 13, calendarColorId: "2", googleCalendarId: null },
      { id: "sim-4", name: "Sarah (Hygienist)", title: "Hygienist", specialty: "Hygiene", workingDays: [1,2,3,4,5], startHour: 9, endHour: 18, lunchStart: 12.5, lunchEnd: 13, calendarColorId: "5", googleCalendarId: null },
    ],
    services: [
      { id: "sim-s1", slug: "cleaning", name: "Routine Cleaning", durationMinutes: 45, defaultProviderId: "sim-4" },
      { id: "sim-s2", slug: "exam", name: "Comprehensive Exam", durationMinutes: 60, defaultProviderId: "sim-1" },
      { id: "sim-s3", slug: "filling", name: "Filling", durationMinutes: 75, defaultProviderId: "sim-1" },
      { id: "sim-s4", slug: "ortho_consult", name: "Orthodontic Consult", durationMinutes: 45, defaultProviderId: "sim-2" },
      { id: "sim-s5", slug: "pediatric_exam", name: "Pediatric Exam", durationMinutes: 45, defaultProviderId: "sim-3" },
      { id: "sim-s6", slug: "whitening_consult", name: "Whitening Consult", durationMinutes: 30, defaultProviderId: "sim-1" },
      { id: "sim-s7", slug: "root_canal", name: "Root Canal", durationMinutes: 90, defaultProviderId: "sim-1" },
      { id: "sim-s8", slug: "extraction", name: "Extraction", durationMinutes: 60, defaultProviderId: "sim-1" },
      { id: "sim-s9", slug: "implant_consult", name: "Implant Consult", durationMinutes: 60, defaultProviderId: "sim-1" },
      { id: "sim-s10", slug: "emergency", name: "Emergency", durationMinutes: 45, defaultProviderId: "sim-1" },
    ],
    status: "active",
    systemPromptOverrides: null,
  };

  logger.info(`\n[PIPELINE] Starting pipeline for call ${callData.call_id} | Clinic: ${effectiveClinic.name}`);
  logger.info(`[PIPELINE] Mode: ${SIMULATION ? "SIMULATION" : "PRODUCTION"}\n`);

  let crisis: { is_crisis: boolean; reason: string | null };
  let patient: PatientInfo | null;
  let intent: string;
  let sentiment: string | undefined;
  let callSummary: string | undefined;
  let analysisMethod: "claude" | "regex" = "regex";

  // Try Claude-powered analysis first (replaces Steps 1-3)
  const claudeResult = await analyzeTranscriptWithClaude(callData.transcript, effectiveClinic);

  if (claudeResult) {
    analysisMethod = "claude";
    crisis = claudeResult.crisis;
    patient = claudeResult.patient;
    intent = claudeResult.intent;
    sentiment = claudeResult.sentiment;
    callSummary = claudeResult.summary;

    logger.info("[1-3/6] Claude Analysis (combined)...");
    logger.info(`  >> Method: Claude AI`);
    logger.info(`  >> Crisis: ${crisis.is_crisis ? `DETECTED — ${crisis.reason}` : "none"}`);
    logger.info(`  >> Patient: ${patient ? `${patient.name} | New: ${patient.is_new_patient}` : "not extracted"}`);
    logger.info(`  >> Intent: ${intent}`);
    logger.info(`  >> Sentiment: ${sentiment}`);
    logger.info(`  >> Summary: ${callSummary}`);
  } else {
    // Fallback: regex-based analysis (original Steps 1-3)
    logger.info("[1/6] Crisis Detector (regex)...");
    crisis = detectCrisis(callData.transcript);
    if (crisis.is_crisis) {
      logger.info(`  >> CRISIS DETECTED: ${crisis.reason}`);
    } else {
      logger.info("  >> No crisis detected");
    }

    logger.info("[2/6] Patient Qualifier (regex)...");
    patient = extractPatientInfo(callData.transcript);
    if (patient) {
      logger.info(`  >> Patient: ${patient.name} | New: ${patient.is_new_patient} | Insurance: ${patient.insurance || "not provided"}`);
    } else {
      logger.info("  >> Insufficient patient info extracted");
    }

    logger.info("[3/6] Intent Classifier (regex)...");
    intent = classifyIntent(callData.transcript);
    logger.info(`  >> Intent: ${intent}`);
  }

  // Step 4: Calendar Check + Slot Proposal
  logger.info("[4/6] Calendar Checker + Slot Proposer...");
  const slots = await findAvailableSlots(intent, callData.transcript, effectiveClinic);
  if (slots.length > 0) {
    logger.info(`  >> Found ${slots.length} available slots:`);
    slots.forEach((s) => logger.info(`     - ${s.day} ${s.date} at ${s.time} with ${s.provider}`));
  } else {
    logger.info("  >> No slots needed for this intent");
  }

  // Step 5: Generate Response
  logger.info("[5/6] Response Generator...");
  const agentResponse = generateResponse(intent, crisis, patient, slots, effectiveClinic);
  logger.info(`  >> Response: ${agentResponse.substring(0, 80)}...`);

  // Step 6: Notifications
  logger.info("[6/6] Notification Sender...");
  const selectedSlot = slots.length > 0 ? slots[0] : null;

  // Save call log to DB first (if production)
  let callLogId: string | undefined;
  const result: PipelineResult = {
    call_id: callData.call_id,
    agent_response: agentResponse,
    actions: [
      `crisis_check: ${crisis.is_crisis ? "DETECTED" : "clear"}`,
      `patient_qualified: ${patient ? "yes" : "no"}`,
      `intent: ${intent}`,
      `slots_offered: ${slots.length}`,
      `booking_confirmed: false`,
    ],
    intent,
    crisis_detected: crisis.is_crisis,
    crisis_reason: crisis.reason || null,
    patient_info: patient,
    slots_offered: slots,
    booking_confirmed: false,
    notifications_sent: [],
    duration_ms: 0,
    sentiment,
    call_summary: callSummary,
    analysis_method: analysisMethod,
  };

  // Save to DB if not simulation
  if (!SIMULATION && clinic) {
    try {
      callLogId = await saveCallLog(clinic.id, result, {
        transcript: callData.transcript,
        caller_phone: callData.caller_phone,
        recording_url: callData.recording_url,
        duration_seconds: callData.duration_seconds,
      });

      auditLog({
        clinicId: clinic.id,
        action: "call.processed",
        resourceType: "call_log",
        resourceId: callLogId,
        details: { intent, crisis_detected: crisis.is_crisis, call_id: callData.call_id },
      });
    } catch (err: any) {
      logger.error(`  >> [DB] Failed to save call log: ${err.message}`);
    }
  }

  const notifications = await sendNotifications(intent, patient, selectedSlot, effectiveClinic, callLogId);
  notifications.forEach((n) => logger.info(`  >> ${n}`));

  result.notifications_sent = notifications;
  result.actions.push(...notifications);
  result.duration_ms = Date.now() - startMs;

  // Also write to file system in simulation mode
  if (SIMULATION) {
    ensureLogDirs();
    const logFile = path.join(LOG_DIR, "calls", `${callData.call_id}.json`);
    fs.writeFileSync(logFile, JSON.stringify(result, null, 2));
  }

  logger.info(`\n[PIPELINE] Complete in ${result.duration_ms}ms | Clinic: ${effectiveClinic.name}\n`);

  return result;
}
