/**
 * types.ts — Shared types for the multi-tenant SaaS
 */

export interface ProviderConfig {
  id: string;
  name: string;
  title: string | null;
  specialty: string | null;
  workingDays: number[];   // 0=Sun..6=Sat
  startHour: number;
  endHour: number;
  lunchStart: number;
  lunchEnd: number;
  calendarColorId: string;
  googleCalendarId: string | null;
}

export interface ServiceConfig {
  id: string;
  slug: string;
  name: string;
  durationMinutes: number;
  defaultProviderId: string | null;
}

export interface GoogleAuthConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId: string;
}

export interface ClinicCredentials {
  anthropicApiKey: string | null;
  deepgramApiKey: string | null;
  inworldApiKey: string | null;
  inworldVoiceId: string | null;
  inworldModelId: string | null;
  telnyxApiKey: string | null;
  telnyxConnectionId: string | null;
  telnyxFromNumber: string | null;
  telnyxWebhookSecret: string | null;
  sendgridApiKey: string | null;
  gmailUser: string | null;
  gmailAppPassword: string | null;
  googleClientId: string | null;
  googleClientSecret: string | null;
}

export interface ClinicConfig {
  id: string;
  slug: string;
  name: string;
  phone: string | null;
  address: string | null;
  website: string | null;
  timezone: string;
  emergencyNumber: string | null;
  hours: Record<string, { open: string; close: string } | null>;
  insurancePlans: string[];
  voiceTone: string;
  greetingTemplate: string | null;
  twilioPhoneNumber: string | null;
  telnyxPhoneNumber: string | null;
  voiceConfig: Record<string, any>;
  smsFromNumber: string | null;
  emailFrom: string | null;
  emailFromName: string | null;
  googleAuth: GoogleAuthConfig | null;
  providers: ProviderConfig[];
  services: ServiceConfig[];
  status: string;
  systemPromptOverrides: string | null;
}

export interface CallData {
  call_id: string;
  transcript: string;
  caller_phone: string;
  timestamp: string;
  recording_url?: string;
  duration_seconds?: number;
}

export interface PatientInfo {
  name: string | null;
  phone: string | null;
  email: string | null;
  insurance: string | null;
  is_new_patient: boolean;
  age_note: string | null;
}

export interface SlotOffer {
  provider: string;
  date: string;
  day: string;
  time: string;
  service: string;
}

export interface PipelineResult {
  call_id: string;
  agent_response: string;
  actions: string[];
  intent: string;
  crisis_detected: boolean;
  crisis_reason: string | null;
  patient_info: PatientInfo | null;
  slots_offered: SlotOffer[];
  booking_confirmed: boolean;
  notifications_sent: string[];
  duration_ms: number;
  sentiment?: string;
  call_summary?: string;
  analysis_method?: "claude" | "regex";
  // Enhanced logging fields
  compliance_flags?: string[];
  tools_used?: string[];
  language_detected?: string;
  escalation_details?: { reason: string; department: string; timestamp: string } | null;
  quality_score?: number;
}

export interface DailyCallMetric {
  clinicId: string;
  metricDate: string;
  callCount: number;
  bookingCount: number;
  crisisCount: number;
}

// Express request extensions
import { Request } from "express";

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string | null;
    role: string;
    clinicId: string | null;
  };
  clinic?: ClinicConfig;
}
