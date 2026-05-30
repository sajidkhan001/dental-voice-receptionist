-- 012_clinic_credentials.sql
-- Dashboard-managed encrypted provider credentials for self-hosted installs.

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS anthropic_api_key TEXT,
  ADD COLUMN IF NOT EXISTS deepgram_api_key TEXT,
  ADD COLUMN IF NOT EXISTS inworld_api_key TEXT,
  ADD COLUMN IF NOT EXISTS inworld_voice_id TEXT,
  ADD COLUMN IF NOT EXISTS inworld_model_id TEXT,
  ADD COLUMN IF NOT EXISTS telnyx_api_key TEXT,
  ADD COLUMN IF NOT EXISTS telnyx_connection_id TEXT,
  ADD COLUMN IF NOT EXISTS telnyx_from_number TEXT,
  ADD COLUMN IF NOT EXISTS telnyx_webhook_secret TEXT,
  ADD COLUMN IF NOT EXISTS sendgrid_api_key TEXT,
  ADD COLUMN IF NOT EXISTS gmail_user TEXT,
  ADD COLUMN IF NOT EXISTS gmail_app_password TEXT;
