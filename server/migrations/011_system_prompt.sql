-- 011_system_prompt.sql
-- Add system_prompt_overrides to clinics for per-clinic AI persona customization.
-- If set, this replaces the auto-generated prompt from prompt-builder.ts.
-- Allows full white-label customization per dental practice.

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS system_prompt_overrides TEXT;
