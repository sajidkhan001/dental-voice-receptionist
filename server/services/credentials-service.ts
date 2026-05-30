import { execute, query, queryOne, isDbAvailable } from "../lib/db";
import { decryptField, encryptField } from "../lib/encryption";
import { ClinicCredentials } from "../lib/types";

export type CredentialField = keyof ClinicCredentials;

type CredentialRow = {
  anthropic_api_key: string | null;
  deepgram_api_key: string | null;
  inworld_api_key: string | null;
  inworld_voice_id: string | null;
  inworld_model_id: string | null;
  telnyx_api_key: string | null;
  telnyx_connection_id: string | null;
  telnyx_from_number: string | null;
  telnyx_webhook_secret: string | null;
  sendgrid_api_key: string | null;
  gmail_user: string | null;
  gmail_app_password: string | null;
  google_client_id: string | null;
  google_client_secret: string | null;
  sms_from_number: string | null;
  email_from: string | null;
};

const emptyCredentials: ClinicCredentials = {
  anthropicApiKey: null,
  deepgramApiKey: null,
  inworldApiKey: null,
  inworldVoiceId: null,
  inworldModelId: null,
  telnyxApiKey: null,
  telnyxConnectionId: null,
  telnyxFromNumber: null,
  telnyxWebhookSecret: null,
  sendgridApiKey: null,
  gmailUser: null,
  gmailAppPassword: null,
  googleClientId: null,
  googleClientSecret: null,
};

const fieldToColumn: Record<CredentialField, keyof CredentialRow> = {
  anthropicApiKey: "anthropic_api_key",
  deepgramApiKey: "deepgram_api_key",
  inworldApiKey: "inworld_api_key",
  inworldVoiceId: "inworld_voice_id",
  inworldModelId: "inworld_model_id",
  telnyxApiKey: "telnyx_api_key",
  telnyxConnectionId: "telnyx_connection_id",
  telnyxFromNumber: "telnyx_from_number",
  telnyxWebhookSecret: "telnyx_webhook_secret",
  sendgridApiKey: "sendgrid_api_key",
  gmailUser: "gmail_user",
  gmailAppPassword: "gmail_app_password",
  googleClientId: "google_client_id",
  googleClientSecret: "google_client_secret",
};

function envCredentials(): ClinicCredentials {
  return {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,
    deepgramApiKey: process.env.DEEPGRAM_API_KEY || null,
    inworldApiKey: process.env.INWORLD_API_KEY || null,
    inworldVoiceId: process.env.INWORLD_VOICE_ID || null,
    inworldModelId: process.env.INWORLD_MODEL_ID || null,
    telnyxApiKey: process.env.TELNYX_API_KEY || null,
    telnyxConnectionId: process.env.TELNYX_CONNECTION_ID || null,
    telnyxFromNumber: process.env.TELNYX_FROM_NUMBER || null,
    telnyxWebhookSecret: process.env.TELNYX_WEBHOOK_SECRET || null,
    sendgridApiKey: process.env.SENDGRID_API_KEY || null,
    gmailUser: process.env.GMAIL_USER || null,
    gmailAppPassword: process.env.GMAIL_APP_PASSWORD || null,
    googleClientId: process.env.GOOGLE_OAUTH_CLIENT_ID || null,
    googleClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || null,
  };
}

function mergeWithEnv(row: CredentialRow | null): ClinicCredentials {
  const env = envCredentials();
  if (!row) return env;

  return {
    anthropicApiKey: decryptField(row.anthropic_api_key) || env.anthropicApiKey,
    deepgramApiKey: decryptField(row.deepgram_api_key) || env.deepgramApiKey,
    inworldApiKey: decryptField(row.inworld_api_key) || env.inworldApiKey,
    inworldVoiceId: decryptField(row.inworld_voice_id) || env.inworldVoiceId,
    inworldModelId: decryptField(row.inworld_model_id) || env.inworldModelId,
    telnyxApiKey: decryptField(row.telnyx_api_key) || env.telnyxApiKey,
    telnyxConnectionId: decryptField(row.telnyx_connection_id) || env.telnyxConnectionId,
    telnyxFromNumber: decryptField(row.telnyx_from_number) || row.sms_from_number || env.telnyxFromNumber,
    telnyxWebhookSecret: decryptField(row.telnyx_webhook_secret) || env.telnyxWebhookSecret,
    sendgridApiKey: decryptField(row.sendgrid_api_key) || env.sendgridApiKey,
    gmailUser: decryptField(row.gmail_user) || env.gmailUser,
    gmailAppPassword: decryptField(row.gmail_app_password) || env.gmailAppPassword,
    googleClientId: decryptField(row.google_client_id) || env.googleClientId,
    googleClientSecret: decryptField(row.google_client_secret) || env.googleClientSecret,
  };
}

export async function getClinicCredentials(clinicId?: string | null): Promise<ClinicCredentials> {
  if (!clinicId || !isDbAvailable()) return envCredentials();

  const row = await queryOne<CredentialRow>(
    `SELECT anthropic_api_key, deepgram_api_key, inworld_api_key, inworld_voice_id,
            inworld_model_id, telnyx_api_key, telnyx_connection_id, telnyx_from_number,
            telnyx_webhook_secret, sendgrid_api_key, gmail_user, gmail_app_password,
            google_client_id, google_client_secret, sms_from_number, email_from
     FROM clinics
     WHERE id = $1`,
    [clinicId]
  );

  return mergeWithEnv(row || null);
}

export async function saveClinicCredentials(
  clinicId: string,
  values: Partial<Record<CredentialField, string | null>>
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  for (const [field, value] of Object.entries(values) as [CredentialField, string | null][]) {
    const column = fieldToColumn[field];
    if (!column) continue;

    sets.push(`${column} = $${idx}`);
    params.push(value == null || value === "" ? null : encryptField(value.trim()));
    idx++;
  }

  if (sets.length === 0) return;

  sets.push("updated_at = NOW()");
  params.push(clinicId);

  await execute(`UPDATE clinics SET ${sets.join(", ")} WHERE id = $${idx}`, params);
}

function last4(value: string | null): string | null {
  if (!value) return null;
  return value.slice(-4);
}

export async function getCredentialStatus(clinicId: string) {
  const creds = await getClinicCredentials(clinicId);
  return {
    anthropicApiKey: { configured: !!creds.anthropicApiKey, last4: last4(creds.anthropicApiKey) },
    deepgramApiKey: { configured: !!creds.deepgramApiKey, last4: last4(creds.deepgramApiKey) },
    inworldApiKey: { configured: !!creds.inworldApiKey, last4: last4(creds.inworldApiKey) },
    inworldVoiceId: { configured: !!creds.inworldVoiceId, last4: last4(creds.inworldVoiceId) },
    inworldModelId: { configured: !!creds.inworldModelId, last4: last4(creds.inworldModelId) },
    telnyxApiKey: { configured: !!creds.telnyxApiKey, last4: last4(creds.telnyxApiKey) },
    telnyxConnectionId: { configured: !!creds.telnyxConnectionId, last4: last4(creds.telnyxConnectionId) },
    telnyxFromNumber: { configured: !!creds.telnyxFromNumber, last4: last4(creds.telnyxFromNumber) },
    telnyxWebhookSecret: { configured: !!creds.telnyxWebhookSecret, last4: last4(creds.telnyxWebhookSecret) },
    sendgridApiKey: { configured: !!creds.sendgridApiKey, last4: last4(creds.sendgridApiKey) },
    gmailUser: { configured: !!creds.gmailUser, last4: last4(creds.gmailUser) },
    gmailAppPassword: { configured: !!creds.gmailAppPassword, last4: last4(creds.gmailAppPassword) },
    googleClientId: { configured: !!creds.googleClientId, last4: last4(creds.googleClientId) },
    googleClientSecret: { configured: !!creds.googleClientSecret, last4: last4(creds.googleClientSecret) },
  };
}

export async function getGlobalCredentialAvailability() {
  const env = envCredentials();
  const availability = {
    telephony: !!env.telnyxApiKey,
    stt: !!env.deepgramApiKey,
    llm: !!env.anthropicApiKey,
    tts: !!env.inworldApiKey,
    google_calendar: !!(env.googleClientId && env.googleClientSecret),
  };

  if (!isDbAvailable()) return availability;

  const rows = await query<CredentialRow>(
    `SELECT anthropic_api_key, deepgram_api_key, inworld_api_key, inworld_voice_id,
            inworld_model_id, telnyx_api_key, telnyx_connection_id, telnyx_from_number,
            telnyx_webhook_secret, sendgrid_api_key, gmail_user, gmail_app_password,
            google_client_id, google_client_secret, sms_from_number, email_from
     FROM clinics`
  );

  for (const row of rows) {
    const creds = mergeWithEnv(row);
    availability.telephony ||= !!creds.telnyxApiKey;
    availability.stt ||= !!creds.deepgramApiKey;
    availability.llm ||= !!creds.anthropicApiKey;
    availability.tts ||= !!creds.inworldApiKey;
    availability.google_calendar ||= !!(creds.googleClientId && creds.googleClientSecret);
  }

  return availability;
}

export function hasAnyProviderCredentials(creds: ClinicCredentials = emptyCredentials): boolean {
  return !!(
    creds.anthropicApiKey ||
    creds.deepgramApiKey ||
    creds.inworldApiKey ||
    creds.telnyxApiKey ||
    creds.sendgridApiKey ||
    (creds.gmailUser && creds.gmailAppPassword) ||
    (creds.googleClientId && creds.googleClientSecret)
  );
}
