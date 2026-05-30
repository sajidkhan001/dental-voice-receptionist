-- 002_reminders_and_branding.sql
-- Adds reminder tracking, patient confirmation, branding, and language columns

-- Reminder tracking on bookings
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_sent_24h BOOLEAN DEFAULT FALSE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_sent_1h  BOOLEAN DEFAULT FALSE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS patient_confirmed BOOLEAN DEFAULT NULL;

-- Index for reminder queries (upcoming confirmed bookings that haven't been reminded)
CREATE INDEX IF NOT EXISTS idx_bookings_reminder
  ON bookings(appointment_date, start_time)
  WHERE status = 'confirmed' AND (reminder_sent_24h = false OR reminder_sent_1h = false);

-- Clinic branding
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS primary_color VARCHAR(7) DEFAULT '#0d9488';

-- Multilingual support
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS primary_language VARCHAR(10) DEFAULT 'en';
