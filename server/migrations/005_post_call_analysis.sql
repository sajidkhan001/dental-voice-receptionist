-- 005_post_call_analysis.sql
-- Adds sentiment, call summary, and analysis method tracking to call logs

ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS sentiment VARCHAR(20);
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS call_summary TEXT;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS analysis_method VARCHAR(10) DEFAULT 'regex';
