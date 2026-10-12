-- 030: close pending enrichments that can never apply.
-- 2026-10-08. The server never overwrites a filled value, so a pending submission for
-- city, region or founded_year against a nonprofit whose field is already filled can
-- never promote, however many agents agree. New submissions of this kind are now stored
-- as 'superseded' by handleEnrich; this one-off closes the existing ones the same way.
-- Rows keep their agent credit. Nothing is deleted and no nonprofit data changes.
-- website, contact_email and donation_url are NOT touched: those wait for the charity or an admin.
--
-- Preview first (read-only):
--   SELECT field, COUNT(*) FROM agent_enrichments ae JOIN nonprofits n ON n.id = ae.nonprofit_id
--   WHERE ae.status = 'pending' AND (
--     (ae.field = 'city' AND n.city IS NOT NULL AND TRIM(n.city) <> '') OR
--     (ae.field = 'region' AND n.region IS NOT NULL AND TRIM(n.region) <> '') OR
--     (ae.field = 'founded_year' AND n.founded_year IS NOT NULL AND TRIM(CAST(n.founded_year AS TEXT)) <> ''))
--   GROUP BY ae.field;

UPDATE agent_enrichments
   SET status = 'superseded', reviewed_at = datetime('now')
 WHERE status = 'pending'
   AND id IN (
     SELECT ae.id FROM agent_enrichments ae JOIN nonprofits n ON n.id = ae.nonprofit_id
      WHERE ae.status = 'pending' AND (
        (ae.field = 'city' AND n.city IS NOT NULL AND TRIM(n.city) <> '') OR
        (ae.field = 'region' AND n.region IS NOT NULL AND TRIM(n.region) <> '') OR
        (ae.field = 'founded_year' AND n.founded_year IS NOT NULL AND TRIM(CAST(n.founded_year AS TEXT)) <> '')));
