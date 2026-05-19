-- GiveReady — Capture POST body + content-type on enrichment_attempts
-- Adds two columns so the daily digest can show the actual payload shape
-- agents are submitting when they 4xx. Without these, we know an attempt
-- failed but cannot see whether the JSON was malformed, the field was
-- unrecognised, or required keys were missing.
--
-- The body is truncated to 2KB at insert time (handled in
-- logEnrichmentAttempt) so a hostile or oversized payload cannot bloat
-- the table. Content-type is captured raw.
--
-- Both columns are nullable — existing rows have no body or content-type
-- recorded and that's expected.
--
-- Run automatically by deploy.sh step 7 (migrations/*.sql loop).

ALTER TABLE enrichment_attempts ADD COLUMN request_body TEXT;
ALTER TABLE enrichment_attempts ADD COLUMN content_type TEXT;
