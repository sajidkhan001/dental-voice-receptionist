-- 004_noshow_followup.sql
-- Track no-show follow-up attempts (SMS + AI callback)

CREATE TABLE IF NOT EXISTS noshow_followups (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    booking_id      UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,

    followup_type   VARCHAR(20) NOT NULL
                    CHECK (followup_type IN ('sms_initial', 'sms_retry', 'ai_call')),

    outcome         VARCHAR(20) DEFAULT 'pending'
                    CHECK (outcome IN ('pending', 'sent', 'delivered', 'rescheduled', 'declined', 'no_answer', 'failed')),

    call_sid        VARCHAR(64),                -- Twilio call SID for AI callbacks
    rescheduled_booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
    message_body    TEXT,
    notes           TEXT,

    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_noshow_followups_clinic ON noshow_followups(clinic_id);
CREATE INDEX IF NOT EXISTS idx_noshow_followups_booking ON noshow_followups(booking_id);

-- Index for no-show detection query: find confirmed bookings past their time
CREATE INDEX IF NOT EXISTS idx_bookings_noshow_detection
  ON bookings(clinic_id, appointment_date, start_time)
  WHERE status = 'confirmed';
