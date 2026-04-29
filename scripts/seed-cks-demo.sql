-- Seed: City Kids Surfing dashboard pilot demo
-- Run AFTER migration 011 has been applied.
--
-- Local:
--   wrangler d1 execute giveready-db --local --file=./scripts/seed-cks-demo.sql
-- Production:
--   wrangler d1 execute giveready-db --remote --file=./scripts/seed-cks-demo.sql
--
-- What this does:
--   1. Creates Joe's charity_users row bound to CKS (verified_at set, so he can sign in immediately).
--   2. Inserts 6 demo query_log rows with realistic donor-intent phrasing.
--   3. Inserts matching query_matches rows pointing at CKS, so the Searches tab has content on day one.
--
-- Demo queries are explicitly labelled in the UI via the "Demo data" banner.

-- 1. Joe's charity_users row — idempotent via INSERT OR IGNORE on composite unique
INSERT OR IGNORE INTO charity_users (id, nonprofit_id, email, display_name, role, verified_at)
SELECT
  'u-cks-joe-01',
  n.id,
  'joe@getcitykidssurfing.com',
  'Joe Taylor',
  'admin',
  datetime('now')
FROM nonprofits n
WHERE n.slug = 'city-kids-surfing'
LIMIT 1;

-- Also seed Geordie's admin account on CKS for the demo recording
INSERT OR IGNORE INTO charity_users (id, nonprofit_id, email, display_name, role, verified_at)
SELECT
  'u-cks-geordie-01',
  n.id,
  'geordie@testventures.net',
  'Geordie Wardman',
  'admin',
  datetime('now')
FROM nonprofits n
WHERE n.slug = 'city-kids-surfing'
LIMIT 1;

-- 2. Demo query_log rows — spread across the last ~8 days with varied UAs.
-- is_demo=1 keeps these out of /api/admin/traffic recent_queries so they
-- don't pollute the daily digest's real-traffic read. See migration 012.
INSERT OR IGNORE INTO query_log (id, query_text, source, results_count, is_demo, created_at) VALUES
  ('q-demo-cks-01', 'surf therapy charity UK youth', 'ClaudeBot', 3, 1, datetime('now', '-2 hours')),
  ('q-demo-cks-02', 'mental health charity for teenagers', 'GPTBot',   5, 1, datetime('now', '-1 day')),
  ('q-demo-cks-03', 'small charity brighton young people', 'Google-Extended', 2, 1, datetime('now', '-3 days')),
  ('q-demo-cks-04', 'ocean therapy kids anxiety', 'ClaudeBot', 2, 1, datetime('now', '-4 days')),
  ('q-demo-cks-05', 'city kids surfing uk', 'PerplexityBot', 1, 1, datetime('now', '-6 days')),
  ('q-demo-cks-06', 'underprivileged youth outdoor programmes england', 'ClaudeBot', 3, 1, datetime('now', '-8 days'));

-- 3. Match each query to CKS (plus a few spread repeats so the counts match the mockup)
-- Repeat each query multiple times to simulate real volume. Use different query_log IDs per repeat.
-- For MVP demo, we'll just insert one match per query_log row; the dashboard COUNT GROUP BY query_text
-- aggregates multiple query_log rows with the same text. To show 47 hits for "surf therapy charity UK youth",
-- we'd need 47 rows. Instead, the demo uses a smaller but plausible set.

INSERT OR IGNORE INTO query_matches (query_log_id, nonprofit_id, rank, created_at)
SELECT
  'q-demo-cks-01', n.id, 1, datetime('now', '-2 hours')
FROM nonprofits n WHERE n.slug = 'city-kids-surfing';

INSERT OR IGNORE INTO query_matches (query_log_id, nonprofit_id, rank, created_at)
SELECT 'q-demo-cks-02', n.id, 2, datetime('now', '-1 day')
FROM nonprofits n WHERE n.slug = 'city-kids-surfing';

INSERT OR IGNORE INTO query_matches (query_log_id, nonprofit_id, rank, created_at)
SELECT 'q-demo-cks-03', n.id, 1, datetime('now', '-3 days')
FROM nonprofits n WHERE n.slug = 'city-kids-surfing';

INSERT OR IGNORE INTO query_matches (query_log_id, nonprofit_id, rank, created_at)
SELECT 'q-demo-cks-04', n.id, 1, datetime('now', '-4 days')
FROM nonprofits n WHERE n.slug = 'city-kids-surfing';

INSERT OR IGNORE INTO query_matches (query_log_id, nonprofit_id, rank, created_at)
SELECT 'q-demo-cks-05', n.id, 1, datetime('now', '-6 days')
FROM nonprofits n WHERE n.slug = 'city-kids-surfing';

INSERT OR IGNORE INTO query_matches (query_log_id, nonprofit_id, rank, created_at)
SELECT 'q-demo-cks-06', n.id, 3, datetime('now', '-8 days')
FROM nonprofits n WHERE n.slug = 'city-kids-surfing';

-- Sanity check after run:
--   SELECT email, role, verified_at FROM charity_users WHERE email IN ('joe@getcitykidssurfing.com', 'geordie@testventures.net');
--   SELECT query_text, hits FROM (
--     SELECT ql.query_text, COUNT(*) AS hits
--     FROM query_matches qm JOIN query_log ql ON qm.query_log_id = ql.id
--     JOIN nonprofits n ON qm.nonprofit_id = n.id
--     WHERE n.slug = 'city-kids-surfing'
--     GROUP BY ql.query_text ORDER BY hits DESC
--   );
