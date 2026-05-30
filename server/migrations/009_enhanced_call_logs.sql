-- 009_enhanced_call_logs.sql
-- Adds structured metadata fields to call_logs for enhanced conversation logging,
-- performance reporting table, and improvement suggestions table.

-- Enhanced call log fields
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS compliance_flags JSONB DEFAULT '[]';
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS tools_used JSONB DEFAULT '[]';
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS language_detected VARCHAR(5) DEFAULT 'en';
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS escalation_details JSONB;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS quality_score INTEGER;

-- Performance reports table (daily per-clinic metrics)
CREATE TABLE IF NOT EXISTS performance_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    report_date     DATE NOT NULL,
    report_data     JSONB NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(clinic_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_performance_reports_clinic_date
    ON performance_reports(clinic_id, report_date DESC);

-- Improvement suggestions table (self-improver agent output)
CREATE TABLE IF NOT EXISTS improvement_suggestions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    call_log_id     UUID REFERENCES call_logs(id) ON DELETE SET NULL,
    category        VARCHAR(20) NOT NULL,
    suggestion      TEXT NOT NULL,
    priority        VARCHAR(10) NOT NULL DEFAULT 'medium',
    status          VARCHAR(20) NOT NULL DEFAULT 'pending',
    reviewed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_improvement_suggestions_clinic
    ON improvement_suggestions(clinic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_improvement_suggestions_status
    ON improvement_suggestions(status);
