-- 001_initial_schema.sql
-- Multi-tenant SaaS schema for Dental Voice Receptionist

-- Tenant: each dental clinic
CREATE TABLE IF NOT EXISTS clinics (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            VARCHAR(63) UNIQUE NOT NULL,
    name            VARCHAR(255) NOT NULL,
    phone           VARCHAR(20),
    address         TEXT,
    website         VARCHAR(255),
    timezone        VARCHAR(50) DEFAULT 'America/New_York',
    emergency_number VARCHAR(20),

    -- Hours: {"mon": {"open": "09:00", "close": "18:00"}, "sat": {"open": "09:00", "close": "14:00"}, "sun": null}
    hours           JSONB NOT NULL DEFAULT '{}',

    -- Insurance plans accepted
    insurance_plans TEXT[] DEFAULT '{}',

    -- Brand voice
    voice_tone      TEXT DEFAULT 'Warm, calm, professional, empathetic, reassuring.',
    greeting_template TEXT,

    -- Retell AI config
    retell_agent_id     VARCHAR(255),
    retell_llm_id       VARCHAR(255),
    retell_phone_number VARCHAR(20),

    -- Google Calendar OAuth (encrypted at app level)
    google_client_id        TEXT,
    google_client_secret    TEXT,
    google_refresh_token    TEXT,
    google_calendar_id      VARCHAR(255) DEFAULT 'primary',

    -- SMS/Email
    sms_from_number VARCHAR(20),
    email_from      VARCHAR(255),
    email_from_name VARCHAR(255),

    -- Status
    status          VARCHAR(20) DEFAULT 'onboarding'
                    CHECK (status IN ('onboarding', 'active', 'suspended', 'archived')),
    activated_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Providers belong to a clinic
CREATE TABLE IF NOT EXISTS providers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    title           VARCHAR(100),
    specialty       VARCHAR(255),

    -- Schedule: which days they work (0=Sun..6=Sat)
    working_days    INTEGER[] NOT NULL DEFAULT '{1,2,3,4,5}',
    start_hour      NUMERIC(4,2) DEFAULT 9.0,
    end_hour        NUMERIC(4,2) DEFAULT 18.0,
    lunch_start     NUMERIC(4,2) DEFAULT 12.0,
    lunch_end       NUMERIC(4,2) DEFAULT 13.0,

    calendar_color_id VARCHAR(10) DEFAULT '1',
    google_calendar_id VARCHAR(255),

    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_providers_clinic ON providers(clinic_id);

-- Services offered by a clinic
CREATE TABLE IF NOT EXISTS services (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    slug            VARCHAR(63) NOT NULL,
    name            VARCHAR(255) NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 60,
    default_provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(clinic_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_services_clinic ON services(clinic_id);

-- Users who can log in
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    name            VARCHAR(255),
    role            VARCHAR(20) NOT NULL DEFAULT 'clinic_staff'
                    CHECK (role IN ('superadmin', 'clinic_admin', 'clinic_staff')),
    clinic_id       UUID REFERENCES clinics(id) ON DELETE CASCADE,
    is_active       BOOLEAN DEFAULT true,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_clinic ON users(clinic_id);

-- Call logs (replaces logs/calls/*.json)
CREATE TABLE IF NOT EXISTS call_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    call_id         VARCHAR(255) NOT NULL,

    transcript      TEXT,
    caller_phone    VARCHAR(20),
    recording_url   TEXT,
    duration_seconds INTEGER,

    -- Pipeline results
    intent          VARCHAR(50),
    crisis_detected BOOLEAN DEFAULT false,
    crisis_reason   TEXT,
    patient_name    VARCHAR(255),
    patient_phone   VARCHAR(20),
    patient_email   VARCHAR(255),
    patient_insurance VARCHAR(255),
    is_new_patient  BOOLEAN,

    agent_response  TEXT,
    actions         JSONB DEFAULT '[]',
    slots_offered   JSONB DEFAULT '[]',
    booking_confirmed BOOLEAN DEFAULT false,
    notifications_sent JSONB DEFAULT '[]',
    pipeline_duration_ms INTEGER,

    created_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(clinic_id, call_id)
);

CREATE INDEX IF NOT EXISTS idx_call_logs_clinic ON call_logs(clinic_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_created ON call_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_logs_intent ON call_logs(intent);

-- Bookings (replaces logs/bookings/*.json)
CREATE TABLE IF NOT EXISTS bookings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    call_log_id     UUID REFERENCES call_logs(id) ON DELETE SET NULL,

    google_event_id VARCHAR(255),
    provider_id     UUID REFERENCES providers(id) ON DELETE SET NULL,
    service_id      UUID REFERENCES services(id) ON DELETE SET NULL,

    patient_name    VARCHAR(255),
    patient_phone   VARCHAR(20),
    patient_email   VARCHAR(255),
    patient_insurance VARCHAR(255),
    is_new_patient  BOOLEAN,

    appointment_date DATE NOT NULL,
    start_time      TIME NOT NULL,
    duration_minutes INTEGER NOT NULL,

    status          VARCHAR(20) DEFAULT 'confirmed'
                    CHECK (status IN ('confirmed', 'cancelled', 'rescheduled', 'completed', 'no_show')),

    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookings_clinic ON bookings(clinic_id);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(appointment_date);

-- HIPAA Audit Log (append-only, never update/delete)
CREATE TABLE IF NOT EXISTS audit_logs (
    id              BIGSERIAL PRIMARY KEY,
    clinic_id       UUID REFERENCES clinics(id),
    user_id         UUID REFERENCES users(id),
    action          VARCHAR(100) NOT NULL,
    resource_type   VARCHAR(50),
    resource_id     VARCHAR(255),
    details         JSONB,
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_clinic ON audit_logs(clinic_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);

-- Notifications (replaces logs/sms/ and logs/email/)
CREATE TABLE IF NOT EXISTS notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    call_log_id     UUID REFERENCES call_logs(id) ON DELETE SET NULL,
    booking_id      UUID REFERENCES bookings(id) ON DELETE SET NULL,

    channel         VARCHAR(10) NOT NULL CHECK (channel IN ('sms', 'email')),
    recipient       VARCHAR(255) NOT NULL,
    subject         TEXT,
    body            TEXT NOT NULL,

    status          VARCHAR(20) DEFAULT 'sent'
                    CHECK (status IN ('sent', 'delivered', 'failed')),
    external_id     VARCHAR(255),

    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_clinic ON notifications(clinic_id);

-- Escalations (replaces logs/escalations/)
CREATE TABLE IF NOT EXISTS escalations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    call_log_id     UUID REFERENCES call_logs(id) ON DELETE SET NULL,

    reason          TEXT NOT NULL,
    caller_phone    VARCHAR(20),
    transcript_snippet TEXT,
    action_taken    VARCHAR(100),

    resolved        BOOLEAN DEFAULT false,
    resolved_at     TIMESTAMPTZ,
    resolved_by     UUID REFERENCES users(id),

    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_escalations_clinic ON escalations(clinic_id);
