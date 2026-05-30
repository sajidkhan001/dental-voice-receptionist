-- 006_recall_and_reviews.sql
-- Patient recall campaigns + post-visit review collection

-- Recall campaigns table
CREATE TABLE IF NOT EXISTS recall_campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_name    VARCHAR(255) NOT NULL,
  patient_phone   VARCHAR(20) NOT NULL,
  patient_email   VARCHAR(255),
  last_visit_date DATE,
  last_service    VARCHAR(255),
  channel         VARCHAR(20) NOT NULL CHECK (channel IN ('sms', 'ai_call', 'email')),
  status          VARCHAR(20) DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sent', 'delivered', 'booked', 'declined', 'no_answer', 'failed')),
  call_sid        VARCHAR(64),
  message_body    TEXT,
  new_booking_id  UUID REFERENCES bookings(id) ON DELETE SET NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recall_campaigns_clinic ON recall_campaigns(clinic_id);
CREATE INDEX IF NOT EXISTS idx_recall_campaigns_phone ON recall_campaigns(patient_phone);

-- Review requests table
CREATE TABLE IF NOT EXISTS review_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  booking_id      UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  patient_name    VARCHAR(255),
  patient_phone   VARCHAR(20),
  channel         VARCHAR(10) DEFAULT 'sms' CHECK (channel IN ('sms', 'email')),
  status          VARCHAR(20) DEFAULT 'sent'
                  CHECK (status IN ('sent', 'clicked', 'reviewed', 'failed')),
  message_body    TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_requests_clinic ON review_requests(clinic_id);
CREATE INDEX IF NOT EXISTS idx_review_requests_booking ON review_requests(booking_id);

-- Add review tracking to bookings
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS review_requested BOOLEAN DEFAULT FALSE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS review_sent_at TIMESTAMPTZ;

-- Add review links and feature flags to clinics
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS google_review_link TEXT;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS yelp_review_link TEXT;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS features JSONB DEFAULT '{}';
