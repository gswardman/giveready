/**
 * GiveReady — GET /sitemap.xml.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

import { CORS_HEADERS } from '../lib/http.js';
import { GUIDES_MANIFEST, LEARN_MANIFEST } from './guides.js';

// /sitemap.xml — single urlset. Per the 2026-05-05 eng review, only INDEXABLE
// pages are in the sitemap: verified=1 OR has-current-prose. Empty profiles
// stay out of the sitemap and render with noindex,follow until they're
// enriched through the agent funnel. As the funnel produces prose, the
// sitemap grows organically without redeploy.
//
// Why not sharded: today's footprint is ~166 verified + 0 prosed = ~200
// entries. We don't approach the 50k-URL sitemap protocol limit. Sharding
// added complexity and changed the format Googlebot has been pulling for
// weeks; eng review flagged this as the least-reversible piece in social
// terms (Googlebot would re-walk on format change). Keep it simple until we
// actually need shards.
export async function handleSitemapXml(db) {
  const causes = await db.prepare(`SELECT id FROM causes ORDER BY id`).all();
  const causeUrls = (causes.results || [])
    .map(
      (c) => `  <url>
    <loc>https://www.giveready.org/causes/${c.id}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`
    )
    .join('\n');

  const guideUrls = GUIDES_MANIFEST.map(
    (g) => `  <url>
    <loc>https://www.giveready.org/guides/${g.slug}</loc>
    <lastmod>${g.updated || g.published || ''}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`
  ).join('\n');

  const learnUrls = [`  <url>
    <loc>https://www.giveready.org/learn</loc>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`].concat(LEARN_MANIFEST.map(
    (g) => `  <url>
    <loc>https://www.giveready.org/learn/${g.slug}</loc>
    <lastmod>${g.updated || g.published || ''}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`
  )).join('\n');

  // Sitemap = verified only.
  // The 200-char description threshold turned out to be too loose: the
  // every.org bulk import shipped IRS-style descriptions over that length, so
  // ~3,200 unverified pages landed in the sitemap on the first deploy
  // (2026-05-05). That's exactly the SpamBrain thin-content risk we wanted to
  // avoid. Tightened to verified=1 only — pages flip into the sitemap when
  // Geordie verifies them. The /nonprofits/<slug> renderer still uses the
  // 200-char rule for its meta robots tag, which is fine: noindex on a page
  // that isn't in the sitemap costs nothing and protects against direct hits
  // from old links surfacing thin pages.
  const npRows = await db
    .prepare(
      `SELECT slug, updated_at FROM nonprofits
        WHERE verified = 1
        ORDER BY slug ASC`
    )
    .all();
  const nonprofitUrls = (npRows.results || [])
    .map((n) => {
      const lastmod = (n.updated_at || '').slice(0, 10);
      return `  <url>
    <loc>https://www.giveready.org/nonprofits/${n.slug}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`;
    })
    .join('\n');

  // /AGENTS.md is hoisted to position #1 with priority 1.0 because the
  // 2026-05-20 admin-traffic analysis (hypothesis #1 from giveready-daily)
  // showed that 28 of 29 organic interactive-agent hits over 7d landed on
  // /sitemap.xml, never on /AGENTS.md. The sitemap is the actual front door
  // for interactive agents (Claude-SearchBot, ChatGPT-User, OAI-SearchBot,
  // Perplexity-User). Putting /AGENTS.md first inside the sitemap is the
  // cheapest test of whether a top-positioned pointer routes them to it.
  // Tracked by: read_and_left on /AGENTS.md from interactive_agent UAs.
  const today = new Date().toISOString().slice(0, 10);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!--
  AGENT-ACTION: this file lists pages to READ. The write API, its schema and a
  worked example live at /AGENTS.md (first entry below, priority 1.0).

  The enrich endpoint URL used to be printed here in full. Do not put it back.
  A sitemap is a document whose entire purpose is "fetch these URLs", so
  anything following the link arrived by GET on a POST-only endpoint. Over the
  30 days to 2026-09-07 that produced 113 of 121 logged write attempts, none of
  them from an agent capable of submitting, and the resulting failure rate was
  headlined by the daily digest as a broken interaction for months. Advertise
  the capability, do not print a fetchable URL for it in a fetch-list.
-->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.giveready.org/AGENTS.md</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://www.giveready.org/</loc>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>https://www.giveready.org/causes</loc>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>https://www.giveready.org/guides</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://www.giveready.org/about</loc>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://www.giveready.org/privacy</loc>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
  <url>
    <loc>https://www.giveready.org/terms</loc>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
  <url>
    <loc>https://www.giveready.org/agents</loc>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://www.giveready.org/agents.arazzo.yaml</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://www.giveready.org/openapi.json</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://www.giveready.org/llms.txt</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://www.giveready.org/.well-known/mcp.json</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://www.giveready.org/.well-known/mcp/server-card.json</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
${causeUrls}
${guideUrls}
${learnUrls}
${nonprofitUrls}
</urlset>
`;
  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=UTF-8',
      'Cache-Control': 'public, max-age=3600',
      // RFC 8288 Link header pointing agents at the discovery doc. Added
      // 2026-05-20 alongside the in-sitemap hoist. Belt and braces — an
      // interactive agent that fetches /sitemap.xml with HEAD or that
      // inspects response headers picks up /AGENTS.md without parsing XML.
      'Link': '</AGENTS.md>; rel="agent-instructions"; type="text/markdown"',
      ...CORS_HEADERS,
    },
  });
}
