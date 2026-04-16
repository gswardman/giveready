-- 010-rejection-reasons.sql
-- Self-learning loop: when a submission is rejected, store WHY so the next
-- agent that retries the same field can learn from it.
--
-- Two cases produce rejection today:
--   1. promoteIfConsensus picks a winning normalised value for a structured
--      field — losing values get status='rejected' with no explanation.
--   2. (future) admin reject endpoint — currently only rejects nonprofit
--      drafts, not enrichments.
--
-- Both should write rejection_reason and (when relevant) winning_value so
-- the response on the next submission for that nonprofit+field surfaces
-- the prior rejection. That closes the read-and-leave -> retry-blind loop.

ALTER TABLE agent_enrichments ADD COLUMN rejection_reason TEXT;
ALTER TABLE agent_enrichments ADD COLUMN winning_value TEXT;

CREATE INDEX IF NOT EXISTS idx_enrichments_nonprofit_field_status
  ON agent_enrichments(nonprofit_id, field, status);
