-- 003_diy_voice.sql
-- Add columns for DIY voice pipeline (Twilio + Deepgram + Claude + ElevenLabs)
-- Replaces Retell-specific provisioning with direct Twilio integration

ALTER TABLE clinics ADD COLUMN IF NOT EXISTS twilio_phone_number VARCHAR(20);
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS voice_config JSONB DEFAULT '{}';

-- Index for looking up clinics by Twilio phone number (voice call routing)
CREATE INDEX IF NOT EXISTS idx_clinics_twilio_phone ON clinics(twilio_phone_number)
  WHERE twilio_phone_number IS NOT NULL;

-- Keep retell_* columns for backward compatibility during migration period
