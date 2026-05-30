-- 008_features_expansion.sql
-- Adds: calendar sync tracking, multilingual support, patient intake forms,
-- insurance verification, online scheduling support.

-- ===== Calendar Sync (Google Calendar webhooks) =====
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS google_calendar_watch_id VARCHAR(255);
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS google_calendar_watch_expiry TIMESTAMPTZ;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS google_calendar_sync_token TEXT;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS google_calendar_last_sync TIMESTAMPTZ;

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS conflict_detected BOOLEAN DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pms_synced_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'voice'
    CHECK (source IN ('voice', 'widget', 'intake', 'manual', 'pms_sync'));

-- ===== Multilingual Support =====
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS supported_languages TEXT[] DEFAULT '{en}';
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS primary_language VARCHAR(10) DEFAULT 'en';

ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS detected_language VARCHAR(10);

-- ===== Patient Intake Forms =====
CREATE TABLE IF NOT EXISTS patient_intake_forms (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    booking_id      UUID REFERENCES bookings(id) ON DELETE SET NULL,

    -- Patient Info
    patient_name        VARCHAR(255) NOT NULL,
    patient_dob         DATE,
    patient_phone       VARCHAR(20),
    patient_email       VARCHAR(255),
    patient_address     TEXT,

    -- Medical
    medical_history     JSONB DEFAULT '{}',
    current_medications TEXT,
    allergies           TEXT,

    -- Dental
    dental_history      JSONB DEFAULT '{}',
    last_dental_visit   DATE,
    reason_for_visit    TEXT,
    pain_level          INTEGER CHECK (pain_level BETWEEN 0 AND 10),

    -- Insurance
    insurance_carrier   VARCHAR(255),
    insurance_member_id VARCHAR(100),
    insurance_group_number VARCHAR(100),
    insurance_phone     VARCHAR(20),

    -- Consent
    consent_hipaa       BOOLEAN DEFAULT false,
    consent_treatment   BOOLEAN DEFAULT false,
    consent_financial   BOOLEAN DEFAULT false,
    signature_data      TEXT,
    signed_at           TIMESTAMPTZ,

    -- Emergency Contact
    emergency_contact_name  VARCHAR(255),
    emergency_contact_phone VARCHAR(20),
    emergency_contact_relation VARCHAR(100),

    -- Status
    status          VARCHAR(20) DEFAULT 'pending'
                    CHECK (status IN ('pending', 'submitted', 'reviewed', 'archived')),
    submitted_at    TIMESTAMPTZ,
    reviewed_by     UUID REFERENCES users(id),
    reviewed_at     TIMESTAMPTZ,

    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intake_forms_clinic ON patient_intake_forms(clinic_id);
CREATE INDEX IF NOT EXISTS idx_intake_forms_booking ON patient_intake_forms(booking_id);
CREATE INDEX IF NOT EXISTS idx_intake_forms_status ON patient_intake_forms(status);

-- ===== Insurance Verification =====
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS insurance_verified BOOLEAN DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS insurance_verified_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS insurance_verified_by VARCHAR(255);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS insurance_details JSONB DEFAULT '{}';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS intake_completed BOOLEAN DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS intake_form_id UUID REFERENCES patient_intake_forms(id);

-- ===== Online Scheduling Widget =====
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS widget_enabled BOOLEAN DEFAULT false;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS widget_color VARCHAR(7) DEFAULT '#2563EB';
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS widget_services UUID[] DEFAULT '{}';

-- ===== Review Dashboard Enhancements =====
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS review_delay_hours INTEGER DEFAULT 2;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS google_review_link TEXT;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS yelp_review_link TEXT;
