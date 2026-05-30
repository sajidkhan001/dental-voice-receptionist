-- 007_telnyx_migration.sql
-- Add Telnyx phone number column alongside existing Twilio column.
-- Supports running both providers during migration; once Twilio is fully removed,
-- the twilio_phone_number column can be dropped in a future migration.

ALTER TABLE clinics ADD COLUMN IF NOT EXISTS telnyx_phone_number VARCHAR(20);

-- Index for looking up clinics by Telnyx phone number (voice call routing)
CREATE INDEX IF NOT EXISTS idx_clinics_telnyx_phone ON clinics(telnyx_phone_number)
  WHERE telnyx_phone_number IS NOT NULL;
