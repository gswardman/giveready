-- 023-agent-route-index.sql
-- 2026-08-22. Covering index for the agent x route matrix in handleAdminTraffic.
--
-- WHY THIS EXISTS
-- The new discovery_by_agent_route query is:
--   SELECT user_agent, route, COUNT(*), MAX(created_at)
--     FROM discovery_hits
--    WHERE created_at > ? AND user_agent IS NOT NULL
--    GROUP BY user_agent, route
--
-- migrations/011 added idx_discovery_hits_ua_created (user_agent, created_at).
-- That does NOT cover this query: `route` is absent, so D1 reads the base table
-- for every candidate row. discovery_hits grows roughly 2.2k rows/day, so a
-- 30-day admin window already scans ~67k rows, and the daily digest calls the
-- 24h, 168h and 720h windows on every run.
--
-- Column order is deliberate. created_at leads because the filter is a range
-- scan on it; user_agent and route follow so the GROUP BY reads straight off the
-- index without touching the table.
--
-- Apply:
--   wrangler d1 execute giveready --remote --file=migrations/023-agent-route-index.sql
-- Verify:
--   wrangler d1 execute giveready --remote --command \
--     "EXPLAIN QUERY PLAN SELECT user_agent, route, COUNT(*) FROM discovery_hits \
--      WHERE created_at > 0 AND user_agent IS NOT NULL GROUP BY user_agent, route;"
--   Expect: USING INDEX idx_discovery_hits_created_ua_route

CREATE INDEX IF NOT EXISTS idx_discovery_hits_created_ua_route
  ON discovery_hits (created_at, user_agent, route);
