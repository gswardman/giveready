-- 026-traffic-rollup.sql
-- 2026-09-17. Counts EVERY request, not the twenty routes discovery_hits logs.
--
-- Apply:
--   npx wrangler d1 execute giveready-db --remote --file=migrations/026-traffic-rollup.sql
--
-- Verify (expect two empty tables, then rows within a minute of the deploy):
--   npx wrangler d1 execute giveready-db --remote --command \
--     "SELECT bucket, route_class, agent_class, hits FROM traffic_rollup ORDER BY hits DESC LIMIT 10;"
--
-- WHY THIS EXISTS
-- On 2026-09-17 the daily digest was reconciled against the Cloudflare dashboard
-- for the first time. Cloudflare counted 45,610 edge requests in 24 hours.
-- discovery_hits held 1,831 of them, 4.0%. Over 7 days it was 16,992 of 78,550,
-- 21.6%. Every share the digest has ever printed (route-class mix, guide share,
-- the 84.9% "unattributed", the option-B 20% threshold) was computed against
-- that subset while reading as though it described the site.
--
-- The cause is not a bug. logDiscoveryHit fires inside an explicit route
-- allowlist in fetch(): /mcp, /llms.txt, /AGENTS.md, /causes, /guides,
-- /sitemap.xml, /nonprofits/<slug>, /donate/<slug> and a few /api/agents/*.
-- The homepage, the /nonprofits listing and its pagination, /out, /api/stats,
-- /api/nonprofits, /about, /docs and every asset were never written down.
-- Migration 025d named this on 2026-09-02 and it was not acted on then:
-- "/api/nonprofits is also absent from the discovery-logged route list, so its
-- call volume has never been measured, which is exactly the condition under
-- which the /api/stats leak grew unnoticed."
--
-- What made it undeniable: roughly 40,000 requests arrived in under thirty
-- minutes on 2026-09-16 around 11:00 CEST, driving 279,080 D1 queries, about
-- seven per request, with Denmark at 42,344 of the day's 45,610. Worker error
-- rate stayed at 0%, so nothing broke and nothing alerted. None of it appears in
-- discovery_hits. The largest single event of the month was invisible to the
-- report whose entire job is to say what is reading the site.
--
-- WHY A COUNTER AND NOT MORE ROWS
-- The obvious fix, widening the allowlist to every route, writes one row per
-- request into a table that already reached 240,779 rows and has twice been the
-- reason the site went down (2026-09-01, 2026-09-02). At 45k requests a day that
-- is 1.35M rows a month, and a burst day adds 40k rows in half an hour.
--
-- These two tables are O(1) in traffic instead. An upsert bumps a counter in a
-- row that already exists, so a 40,000-request burst touches the same handful of
-- rows 40,000 times and the table does not grow. Cardinality is bounded by
-- construction: at most 24 x route_class x agent_class rows a day in the first
-- table, 24 x country in the second. Realistically it is tens of rows a day.
--
-- Geography is split into its own table rather than added as a fourth key on the
-- first. Keeping country in traffic_rollup would multiply its worst-case row
-- count by the number of countries seen, and the question geography answers
-- ("is today's volume one source or the whole world") does not need it broken
-- down by route.
--
-- discovery_hits is NOT changed by this migration and its allowlist is NOT
-- widened. The agent x route matrix, the guide-reach figures and every
-- historical comparison in daily-stats.md keep the exact meaning they have
-- always had. This adds the denominator those numbers should always have been
-- reported against.

CREATE TABLE IF NOT EXISTS traffic_rollup (
  bucket      TEXT    NOT NULL,   -- UTC hour, 'YYYY-MM-DDTHH'
  route_class TEXT    NOT NULL,   -- routeClassFor(), same taxonomy as the agent x route matrix
  agent_class TEXT    NOT NULL,   -- interactive_agent | training_crawler | search_crawler | unattributed
  hits        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, route_class, agent_class)
);

CREATE TABLE IF NOT EXISTS traffic_geo (
  bucket  TEXT    NOT NULL,       -- UTC hour, 'YYYY-MM-DDTHH'
  country TEXT    NOT NULL,       -- request.cf.country, 'XX' when absent
  hits    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, country)
);

-- The PRIMARY KEYs are the only indexes either table needs. Every read is a
-- range scan on bucket, which is the leading column of both.
