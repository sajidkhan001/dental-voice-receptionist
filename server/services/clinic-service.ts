/**
 * clinic-service.ts — CRUD and config loading for clinics (tenants)
 */

import { query, queryOne, execute } from "../lib/db";
import { decryptField, encryptField } from "../lib/encryption";
import { ClinicConfig, ProviderConfig, ServiceConfig, GoogleAuthConfig } from "../lib/types";
import logger from "../lib/logger";

export async function loadClinicConfig(clinicId: string): Promise<ClinicConfig | null> {
  const clinic = await queryOne<any>(
    `SELECT * FROM clinics WHERE id = $1`,
    [clinicId]
  );
  if (!clinic) return null;

  const providers = await query<any>(
    `SELECT * FROM providers WHERE clinic_id = $1 AND is_active = true ORDER BY name`,
    [clinicId]
  );

  const services = await query<any>(
    `SELECT * FROM services WHERE clinic_id = $1 AND is_active = true ORDER BY name`,
    [clinicId]
  );

  return buildClinicConfig(clinic, providers, services);
}

export async function loadClinicBySlug(slug: string): Promise<ClinicConfig | null> {
  const clinic = await queryOne<any>(
    `SELECT * FROM clinics WHERE slug = $1`,
    [slug]
  );
  if (!clinic) return null;

  const providers = await query<any>(
    `SELECT * FROM providers WHERE clinic_id = $1 AND is_active = true ORDER BY name`,
    [clinic.id]
  );

  const services = await query<any>(
    `SELECT * FROM services WHERE clinic_id = $1 AND is_active = true ORDER BY name`,
    [clinic.id]
  );

  return buildClinicConfig(clinic, providers, services);
}

export async function loadClinicByTwilioNumber(phoneNumber: string): Promise<ClinicConfig | null> {
  return loadClinicByPhoneNumber(phoneNumber);
}

export async function loadClinicByPhoneNumber(phoneNumber: string): Promise<ClinicConfig | null> {
  // Normalize phone number (strip formatting)
  const normalized = phoneNumber.replace(/[^\d+]/g, "");
  // Search both old (twilio_phone_number) and new (telnyx_phone_number) columns
  const clinic = await queryOne<any>(
    `SELECT * FROM clinics WHERE (twilio_phone_number = $1 OR telnyx_phone_number = $1) AND status = 'active'`,
    [normalized]
  );
  if (!clinic) return null;

  const providers = await query<any>(
    `SELECT * FROM providers WHERE clinic_id = $1 AND is_active = true ORDER BY name`,
    [clinic.id]
  );

  const services = await query<any>(
    `SELECT * FROM services WHERE clinic_id = $1 AND is_active = true ORDER BY name`,
    [clinic.id]
  );

  return buildClinicConfig(clinic, providers, services);
}

export async function createClinic(data: {
  slug: string;
  name: string;
  phone?: string;
  address?: string;
  website?: string;
  timezone?: string;
  emergencyNumber?: string;
  hours?: Record<string, any>;
  insurancePlans?: string[];
  voiceTone?: string;
  greetingTemplate?: string;
}): Promise<string> {
  const result = await queryOne<{ id: string }>(
    `INSERT INTO clinics (slug, name, phone, address, website, timezone, emergency_number, hours, insurance_plans, voice_tone, greeting_template)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      data.slug,
      data.name,
      data.phone || null,
      data.address || null,
      data.website || null,
      data.timezone || "America/New_York",
      data.emergencyNumber || null,
      JSON.stringify(data.hours || {}),
      data.insurancePlans || [],
      data.voiceTone || "Warm, calm, professional, empathetic, reassuring.",
      data.greetingTemplate || null,
    ]
  );
  return result!.id;
}

export async function updateClinic(clinicId: string, data: Partial<{
  name: string;
  phone: string;
  address: string;
  website: string;
  timezone: string;
  emergencyNumber: string;
  hours: Record<string, any>;
  insurancePlans: string[];
  voiceTone: string;
  greetingTemplate: string;
  systemPromptOverrides: string | null;
  twilioPhoneNumber: string;
  telnyxPhoneNumber: string;
  smsFromNumber: string;
  emailFrom: string;
  emailFromName: string;
  googleReviewLink: string;
  yelpReviewLink: string;
  features: Record<string, any>;
  status: string;
}>): Promise<void> {
  const sets: string[] = [];
  const values: any[] = [];
  let idx = 1;

  const fieldMap: Record<string, string> = {
    name: "name",
    phone: "phone",
    address: "address",
    website: "website",
    timezone: "timezone",
    emergencyNumber: "emergency_number",
    hours: "hours",
    insurancePlans: "insurance_plans",
    voiceTone: "voice_tone",
    greetingTemplate: "greeting_template",
    systemPromptOverrides: "system_prompt_overrides",
    twilioPhoneNumber: "twilio_phone_number",
    telnyxPhoneNumber: "telnyx_phone_number",
    smsFromNumber: "sms_from_number",
    emailFrom: "email_from",
    emailFromName: "email_from_name",
    googleReviewLink: "google_review_link",
    yelpReviewLink: "yelp_review_link",
    features: "features",
    status: "status",
  };

  for (const [key, col] of Object.entries(fieldMap)) {
    if (key in data) {
      const val = (data as any)[key];
      sets.push(`${col} = $${idx}`);
      values.push(key === "hours" || key === "features" ? JSON.stringify(val) : val);
      idx++;
    }
  }

  if (data.status === "active") {
    sets.push(`activated_at = NOW()`);
  }

  sets.push(`updated_at = NOW()`);
  values.push(clinicId);

  await execute(
    `UPDATE clinics SET ${sets.join(", ")} WHERE id = $${idx}`,
    values
  );
}

export async function updateClinicGoogleAuth(clinicId: string, auth: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId: string;
}): Promise<void> {
  await execute(
    `UPDATE clinics SET
       google_client_id = $1,
      google_client_secret = $2,
      google_refresh_token = $3,
       google_calendar_id = $4,
       updated_at = NOW()
     WHERE id = $5`,
    [
      encryptField(auth.clientId),
      encryptField(auth.clientSecret),
      encryptField(auth.refreshToken),
      auth.calendarId,
      clinicId,
    ]
  );
}

export async function listClinics(): Promise<any[]> {
  return query(
    `SELECT id, slug, name, phone, status, twilio_phone_number, activated_at, created_at
     FROM clinics ORDER BY created_at DESC`
  );
}

export async function createProvider(clinicId: string, data: {
  name: string;
  title?: string;
  specialty?: string;
  workingDays?: number[];
  startHour?: number;
  endHour?: number;
  lunchStart?: number;
  lunchEnd?: number;
  calendarColorId?: string;
}): Promise<string> {
  const result = await queryOne<{ id: string }>(
    `INSERT INTO providers (clinic_id, name, title, specialty, working_days, start_hour, end_hour, lunch_start, lunch_end, calendar_color_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      clinicId,
      data.name,
      data.title || null,
      data.specialty || null,
      data.workingDays || [1, 2, 3, 4, 5],
      data.startHour ?? 9.0,
      data.endHour ?? 18.0,
      data.lunchStart ?? 12.0,
      data.lunchEnd ?? 13.0,
      data.calendarColorId || "1",
    ]
  );
  return result!.id;
}

export async function createService(clinicId: string, data: {
  slug: string;
  name: string;
  durationMinutes: number;
  defaultProviderId?: string;
}): Promise<string> {
  const result = await queryOne<{ id: string }>(
    `INSERT INTO services (clinic_id, slug, name, duration_minutes, default_provider_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [clinicId, data.slug, data.name, data.durationMinutes, data.defaultProviderId || null]
  );
  return result!.id;
}

// --- Internal helpers ---

function buildClinicConfig(clinic: any, providers: any[], services: any[]): ClinicConfig {
  let googleAuth: GoogleAuthConfig | null = null;
  if (clinic.google_client_id && clinic.google_client_secret && clinic.google_refresh_token) {
    try {
      googleAuth = {
        clientId: decryptField(clinic.google_client_id) || clinic.google_client_id,
        clientSecret: decryptField(clinic.google_client_secret) || clinic.google_client_secret,
        refreshToken: decryptField(clinic.google_refresh_token) || clinic.google_refresh_token,
        calendarId: clinic.google_calendar_id || "primary",
      };
    } catch (err) {
      logger.error(`[CLINIC] Failed to decrypt Google auth for clinic ${clinic.id}:`, err);
    }
  }

  return {
    id: clinic.id,
    slug: clinic.slug,
    name: clinic.name,
    phone: clinic.phone,
    address: clinic.address,
    website: clinic.website,
    timezone: clinic.timezone,
    emergencyNumber: clinic.emergency_number,
    hours: typeof clinic.hours === "string" ? JSON.parse(clinic.hours) : clinic.hours,
    insurancePlans: clinic.insurance_plans || [],
    voiceTone: clinic.voice_tone,
    greetingTemplate: clinic.greeting_template,
    twilioPhoneNumber: clinic.twilio_phone_number,
    telnyxPhoneNumber: clinic.telnyx_phone_number || null,
    voiceConfig: typeof clinic.voice_config === "string" ? JSON.parse(clinic.voice_config) : (clinic.voice_config || {}),
    smsFromNumber: clinic.sms_from_number,
    emailFrom: clinic.email_from,
    emailFromName: clinic.email_from_name,
    googleAuth,
    providers: providers.map(mapProvider),
    services: services.map(mapService),
    status: clinic.status,
    systemPromptOverrides: clinic.system_prompt_overrides || null,
  };
}

function mapProvider(p: any): ProviderConfig {
  return {
    id: p.id,
    name: p.name,
    title: p.title,
    specialty: p.specialty,
    workingDays: p.working_days,
    startHour: parseFloat(p.start_hour),
    endHour: parseFloat(p.end_hour),
    lunchStart: parseFloat(p.lunch_start),
    lunchEnd: parseFloat(p.lunch_end),
    calendarColorId: p.calendar_color_id,
    googleCalendarId: p.google_calendar_id,
  };
}

function mapService(s: any): ServiceConfig {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    durationMinutes: s.duration_minutes,
    defaultProviderId: s.default_provider_id,
  };
}
