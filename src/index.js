/**
 * GiveReady API
 * Making small nonprofits discoverable and donatable through AI
 *
 * Cloudflare Worker + D1
 * https://giveready.org
 */

import {
  handleAdminAuditStatus,
  handleAuditApprove,
  handleAdminAuditRequests,
} from './admin/audit.js';
import {
  handleAdminEnrichmentsPending,
  handleAdminEnrichmentApply,
  handleAdminEnrichmentReject,
  handleAdminEnrichmentsReview,
} from './admin/enrichments.js';
import { handleOnboardingFunnel, handleGuideFunnel, handleGuideCrawl } from './admin/funnels.js';
import {
  handleAdminVerify,
  handleAdminDrafts,
  handleAdminApprove,
  handleAdminReject,
  handleAdminDescriptionEdit,
} from './admin/nonprofits.js';
import { handleAdminReconcile } from './admin/reconcile.js';
import { handleAdminTraffic } from './admin/traffic.js';
import {
  handleAgentLeaderboard,
  handleAgentExemplars,
  handleAgentFunnel,
  handleAgentNamedFirstSeen,
} from './api/agents.js';
import {
  refreshAiTraffic,
  refreshAiTraffic30d,
  handleAiTraffic,
  handleAiTrafficProfile,
} from './api/ai-traffic.js';
import {
  handleRoot,
  handleSearch,
  handleListNonprofits,
  handleListCauses,
} from './api/directory.js';
import { handleDonate, handleDonationHistory, handleOutboundDonate } from './api/donate.js';
import {
  handleNeedsEnrichment,
  logEnrichmentAttempt,
  buildEnrichmentBrief,
  handleEnrich,
  handleEnrichmentStats,
} from './api/enrichment.js';
import {
  handleMCPManifest,
  handleAIPlugin,
  handleWellKnownMcpManifest,
  handleWellKnownServerCard,
  handleMcpRpc,
} from './api/mcp.js';
import { handleGetNonprofit } from './api/nonprofits.js';
import { handleOnboard } from './api/onboard.js';
import { handleRecommend } from './api/recommend.js';
import {
  handleRegistryEins,
  handleRegistryRevoked,
  handleVerifyRegistration,
} from './api/registry.js';
import { handleStats } from './api/stats.js';
import {
  handleCharityMe,
  handleCharitySwitch,
  handleCharityProfileGet,
  handleCharityProfilePatch,
  handleCharityQueries,
  handleCharityDonations,
  handleClaimRequest,
} from './auth/charity-api.js';
import { handleClaim, handleVerifyToken } from './auth/claim.js';
import { handleAuthRequest, handleAuthVerify, handleAuthLogout } from './auth/magic-link.js';
import { reconcileAll } from './cron/reconcile.js';
import { CORS_HEADERS, json, error, noStore } from './lib/http.js';
import { checkRateLimit } from './lib/rate-limit.js';
import { refreshDirectoryStats } from './lib/stats-cache.js';
import { logDiscoveryHit, recordTraffic, discoveryRefFromUrl } from './lib/telemetry.js';
import { handleAgentLeaderboardHTML } from './pages/agents.js';
import { handleCausePage, handleCausesIndex } from './pages/causes.js';
import {
  INDEXNOW_KEY,
  handleIndexNowKey,
  handleRobotsTxt,
  handleLlmsTxt,
  handleAgentsMd,
} from './pages/discovery.js';
import { DONATE_PAGE_HTML } from './pages/donate.js';
import { handleGuide, handleLearnIndex, handleGuidesIndex } from './pages/guides.js';
import { handleNonprofitPage } from './pages/nonprofit.js';
import { handleSitemapXml } from './pages/sitemap.js';
import {
  handleIssueChallenge,
  handleVerifyChallenge,
} from './wallet-proof.js';
import { handlePayable } from './payable.js';
import { walletProofPageHTML } from './wallet-proof-page.js';

// ============================================
// ROUTER
// ============================================

// _httpHandler holds the actual routing logic. The exported `fetch` below is a
// thin wrapper that adds HEAD support (RFC 7231 §4.3.2 — HEAD = GET minus body).
// Some 2026 MCP discovery clients HEAD a URL before GETting it; if HEAD returns
// 405, those clients treat the endpoint as missing.
const _httpHandler = {
  async handle(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Allow GET, POST, PATCH (PATCH for /api/charity/profile editing).
    // HEAD is handled by the outer wrapper, which rewrites HEAD→GET before
    // reaching this function, so HEAD never trips this check.
    if (request.method !== 'GET' && request.method !== 'POST' && request.method !== 'PATCH') {
      return error('Method not allowed', 405);
    }

    try {
      // Routes
      if (path === '/' || path === '/api') return handleRoot();
      if (path === '/api/search') return handleSearch(env.DB, url);
      if (path === '/api/recommend') return handleRecommend(env.DB, url, request);
      if (path === '/api/nonprofits') return handleListNonprofits(env.DB, url);
      if (path === '/api/registry/eins') return handleRegistryEins(env.DB, url);
      if (path === '/api/registry/revoked') return handleRegistryRevoked(env.DB, url);
      if (path === '/api/causes') return handleListCauses(env.DB);
      if (path === '/api/stats') return handleStats(env.DB);
      if (path === '/api/ai-traffic') return handleAiTraffic(env.DB);
      if (path === '/api/ai-traffic/profile') return handleAiTrafficProfile(env.DB, url);

      // Onboard endpoint
      if (path === '/api/onboard' && request.method === 'POST') {
        const rl = checkRateLimit(request, 'write');
        if (rl) return rl;
        return handleOnboard(env.DB, request);
      }

      // Admin endpoints
      if (path === '/api/admin/reconcile') {
        return handleAdminReconcile(env.DB, env, request);
      }
      if (path === '/api/admin/traffic') {
        return handleAdminTraffic(env.DB, env, request, url);
      }
      if (path === '/api/admin/funnel-guides') {
        return handleGuideFunnel(env.DB, env, request, url);
      }
      if (path === '/api/admin/funnel-onboarding') {
        return handleOnboardingFunnel(env.DB, env, request, url);
      }
      if (path === '/api/admin/guide-crawl') {
        return handleGuideCrawl(env.DB, env, request, url);
      }
      if (path === '/api/admin/drafts') {
        return handleAdminDrafts(env.DB, env, request);
      }
      if (path === '/api/admin/audit-requests') {
        return handleAdminAuditRequests(env.DB, env, request, url);
      }
      if (path === '/api/admin/audit-requests/status' && request.method === 'POST') {
        return handleAdminAuditStatus(env.DB, env, request);
      }
      if (path === '/api/admin/audit-approve') {
        return handleAuditApprove(env.DB, env, url);
      }
      const approveMatch = path.match(/^\/api\/admin\/approve\/([a-z0-9-]+)$/);
      if (approveMatch && request.method === 'POST') {
        return handleAdminApprove(env.DB, env, request, approveMatch[1]);
      }
      const rejectMatch = path.match(/^\/api\/admin\/reject\/([a-z0-9-]+)$/);
      if (rejectMatch && request.method === 'POST') {
        return handleAdminReject(env.DB, env, request, rejectMatch[1]);
      }

      // Admin enrichment review queue (token-gated; daily human-in-the-loop).
      // List, apply, or reject pending enrichments. Match UUID-shaped IDs.
      if (path === '/api/admin/enrichments/pending') {
        return handleAdminEnrichmentsPending(env.DB, env, request, url);
      }
      const enrichApplyMatch = path.match(/^\/api\/admin\/enrichments\/([0-9a-f-]{36})\/apply$/);
      if (enrichApplyMatch && request.method === 'POST') {
        return handleAdminEnrichmentApply(env.DB, env, request, enrichApplyMatch[1]);
      }
      const enrichRejectMatch = path.match(/^\/api\/admin\/enrichments\/([0-9a-f-]{36})\/reject$/);
      if (enrichRejectMatch && request.method === 'POST') {
        return handleAdminEnrichmentReject(env.DB, env, request, enrichRejectMatch[1]);
      }

      // Magic link claim endpoint
      const claimMatch = path.match(/^\/api\/claim\/([a-z0-9-]+)$/);
      if (claimMatch && request.method === 'POST') {
        const rl = checkRateLimit(request, 'write');
        if (rl) return rl;
        return handleClaim(env.DB, env, request, claimMatch[1]);
      }

      // Magic link verification (email click) — one-time claim flow
      if (path === '/verify') {
        return handleVerifyToken(env.DB, env, url);
      }

      // ============================================
      // Charity self-serve dashboard (migration 011)
      // ============================================

      // Static HTML pages for the dashboard flow — fetch from ASSETS, wrap with CSP + CORS.
      // Paths without extension (clean URLs) fall through here since not_found_handling = none.
      const DASHBOARD_PAGES = {
        '/signin': '/signin.html',
        '/check-email': '/check-email.html',
        '/dashboard': '/dashboard.html',
        '/claim': '/claim.html',
      };
      if (DASHBOARD_PAGES[path] && request.method === 'GET') {
        const assetUrl = new URL(DASHBOARD_PAGES[path], request.url).toString();
        const assetResp = await env.ASSETS.fetch(assetUrl);
        const html = await assetResp.text();
        return new Response(html, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=UTF-8',
            'Cache-Control': 'public, max-age=300, must-revalidate',
            ...CORS_HEADERS,
          },
        });
      }

      // Passwordless login
      if (path === '/api/auth/request' && request.method === 'POST') {
        return handleAuthRequest(env.DB, env, ctx, request);
      }
      if (path === '/api/auth/verify' && (request.method === 'GET' || request.method === 'POST')) {
        return handleAuthVerify(env.DB, env, request, url);
      }
      if (path === '/api/auth/logout' && request.method === 'POST') {
        return handleAuthLogout(env.DB, request);
      }

      // Authenticated charity endpoints
      if (path === '/api/charity/me' && request.method === 'GET') {
        return handleCharityMe(env.DB, request);
      }
      if (path === '/api/charity/switch' && request.method === 'POST') {
        return handleCharitySwitch(env.DB, request);
      }
      if (path === '/api/charity/profile' && request.method === 'GET') {
        return handleCharityProfileGet(env.DB, request);
      }
      if (path === '/api/charity/profile' && request.method === 'PATCH') {
        return handleCharityProfilePatch(env.DB, request);
      }
      if (path === '/api/charity/queries' && request.method === 'GET') {
        return handleCharityQueries(env.DB, request, url);
      }
      if (path === '/api/charity/donations' && request.method === 'GET') {
        return handleCharityDonations(env.DB, request);
      }

      // Unauthenticated: request access to a charity (admin reviews)
      if (path === '/api/charity/claim-request' && request.method === 'POST') {
        return handleClaimRequest(env.DB, request, env, ctx);
      }

      // Admin manual verify
      const adminVerifyMatch = path.match(/^\/api\/admin\/verify\/([a-z0-9-]+)$/);
      if (adminVerifyMatch && request.method === 'POST') {
        return handleAdminVerify(env.DB, env, request, adminVerifyMatch[1]);
      }

      // Registration verification (existing charity commission check)
      if (path === '/api/verify-registration') {
        return handleVerifyRegistration(env.DB, env, url);
      }

      if (path === '/mcp' || path === '/mcp/sse' || path === '/.well-known/ai-plugin.json' || path === '/.well-known/mcp.json' || path === '/.well-known/mcp' || path === '/.well-known/mcp/server-card.json' || path === '/llms.txt' || path === '/agents.md' || path === '/AGENTS.md' || path === '/causes' || path === '/guides' || path === '/learn' || path.startsWith('/learn/') || path === '/sitemap.xml' || path.startsWith('/causes/') || path.startsWith('/guides/') || path.startsWith('/nonprofits/') || path === '/api/needs-enrichment' || path === '/api/enrichments/stats' || path === '/api/agents/leaderboard' || path === '/api/agents/exemplars' || path === '/api/agents/funnel' || path === '/api/agents/named-first-seen' || path === '/agents' || path.startsWith('/api/enrich/') || path.startsWith('/donate/') || path.startsWith('/api/wallet-proof/') || (path.startsWith('/api/nonprofits/') && path.endsWith('/payable')) || path.startsWith('/wallet-proof/')) {
        const ua = request.headers.get('User-Agent');
        const referrer = (request.headers.get('Referer') || '').slice(0, 300) || null;
        const refParam = discoveryRefFromUrl(url);
        ctx.waitUntil(logDiscoveryHit(env.DB, path, ua, referrer, refParam));
      }
      // /mcp — content-negotiated. POST = JSON-RPC over Streamable HTTP (2025-03-26).
      // GET = legacy manifest for older clients that pull the tool catalog as JSON.
      // /mcp/sse — same Streamable HTTP transport, alternate URL path so
      // clients that hard-code "/sse" as the MCP endpoint also work.
      if (path === '/mcp' && request.method === 'POST') return handleMcpRpc(env.DB, env, request);
      if (path === '/mcp/sse') return handleMcpRpc(env.DB, env, request);
      if (path === '/mcp') return handleMCPManifest();
      if (path === '/.well-known/ai-plugin.json') return handleAIPlugin();
      // 2026 SEP-1960 manifest — served at both /.well-known/mcp.json (most-cited path)
      // and /.well-known/mcp (path used in some references) so client implementations
      // that diverge on trailing-.json land on the same payload.
      if (path === '/.well-known/mcp.json' || path === '/.well-known/mcp') return handleWellKnownMcpManifest();
      // 2026 SEP-1649 server card
      if (path === '/.well-known/mcp/server-card.json') return handleWellKnownServerCard();
      if (path === '/robots.txt') return handleRobotsTxt();
      // IndexNow ownership-verification key file. Must resolve before the
      // asset router so /<key>.txt is never shadowed by a static 404.
      if (path === '/' + INDEXNOW_KEY + '.txt') return handleIndexNowKey();
      if (path === '/llms.txt') return handleLlmsTxt();
      // Both /agents.md (lowercase, original) and /AGENTS.md (capital, 2026 root convention)
      // serve the same dynamic instruction page with bounty + 30-second wins + leaderboard.
      if (path === '/agents.md' || path === '/AGENTS.md') return handleAgentsMd(env.DB);

      // Cause landing pages — server-rendered HTML with Schema.org JSON-LD for AEO citations.
      // /causes index, /causes/{id} per cause, /sitemap.xml exposing them to crawlers.
      if (path === '/causes') return handleCausesIndex(env.DB);
      const causePageMatch = path.match(/^\/causes\/([a-z0-9-]+)$/);
      if (causePageMatch) return handleCausePage(env.DB, causePageMatch[1]);
      if (path === '/sitemap.xml') return handleSitemapXml(env.DB);

      // Nonprofit HTML pages — server-rendered with Schema.org NonprofitOrganization
      // for verified=1, weak Organization for unverified-but-prosed.
      // Slugs like 3-ds-aftercare-inc, finn-wardman-world-explorer-fund.
      const nonprofitPageMatch = path.match(/^\/nonprofits\/([a-z0-9-]+)$/);
      if (nonprofitPageMatch) return handleNonprofitPage(env.DB, nonprofitPageMatch[1], url);

      // Admin: description editor (Saturday's 166-pass).
      // GET renders the form; POST writes nonprofits.description directly.
      const adminDescEditMatch = path.match(/^\/admin\/nonprofits\/([a-z0-9-]+)\/edit$/);
      if (adminDescEditMatch) {
        return handleAdminDescriptionEdit(env.DB, env, request, adminDescEditMatch[1]);
      }

      // Admin: enrichment review UI (token-gated HTML over the pending queue).
      if (path === '/admin/enrichments') {
        return handleAdminEnrichmentsReview(env.DB, env, request, url);
      }

      // Guides — markdown-backed AEO content surface. Index + per-slug.
      if (path === '/learn' || path === '/learn/') return handleLearnIndex();
      const learnMatch = path.match(/^\/learn\/([a-z0-9-]+)$/);
      if (learnMatch) return handleGuide(env, learnMatch[1], 'learn');
      if (path === '/guides') return handleGuidesIndex();
      const guideMatch = path.match(/^\/guides\/([a-z0-9-]+)$/);
      if (guideMatch) return handleGuide(env, guideMatch[1]);

      // Trust pages — clean-URL routing to static HTML (Google heuristic wants these)
      const TRUST_PAGES = { '/about': '/about.html', '/privacy': '/privacy.html', '/terms': '/terms.html' };
      if (TRUST_PAGES[path] && request.method === 'GET') {
        const assetUrl = new URL(TRUST_PAGES[path], request.url).toString();
        const assetResp = await env.ASSETS.fetch(assetUrl);
        const html = await assetResp.text();
        return new Response(html, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=UTF-8',
            'Cache-Control': 'public, max-age=3600, must-revalidate',
            ...CORS_HEADERS,
          },
        });
      }

      // Public agent leaderboard
      if (path === '/api/agents/leaderboard') return handleAgentLeaderboard(env.DB);

      // Wallet ownership proof (2026-09-21). GET issues a challenge, POST verifies
      // it. Offline message signing only: no transaction is ever constructed here
      // and no private key is ever accepted.
      // Donor-agent payability check (2026-09-21). Answers the recipient-exists /
      // wallet-control / linkage questions in the order an agent actually runs
      // them, with provenance, and says no when the answer is no.
      if (path.startsWith('/api/nonprofits/') && path.endsWith('/payable')) {
        const pSlug = decodeURIComponent(
          path.slice('/api/nonprofits/'.length, path.length - '/payable'.length),
        );
        if (!pSlug) return json({ error: 'slug_required' }, 400);
        const r = await handlePayable(env.DB, pSlug);
        return json(r.body, r.status);
      }

      // Signing UI for the wallet proof. Served as HTML because the CLI's
      // sign-offchain-message uses the SIMD-0009 envelope, which our raw-bytes
      // verifier will not match. The wallet extension's signMessage() does.
      if (path.startsWith('/wallet-proof/')) {
        const uiSlug = decodeURIComponent(path.slice('/wallet-proof/'.length)).replace(/\/+$/, '');
        if (!uiSlug) return json({ error: 'slug_required' }, 400);
        return new Response(walletProofPageHTML(uiSlug), {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex' },
        });
      }

      if (path.startsWith('/api/wallet-proof/')) {
        const wpSlug = decodeURIComponent(path.slice('/api/wallet-proof/'.length)).replace(/\/+$/, '');
        if (!wpSlug) return json({ error: 'slug_required' }, 400);
        if (request.method === 'GET') {
          const r = await handleIssueChallenge(env.DB, wpSlug);
          return json(r.body, r.status);
        }
        if (request.method === 'POST') {
          let wpBody = {};
          try { wpBody = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
          const r = await handleVerifyChallenge(env.DB, wpSlug, wpBody.signature);
          return json(r.body, r.status);
        }
        return json({ error: 'method_not_allowed', allowed: ['GET', 'POST'] }, 405);
      }
      if (path === '/agents') return handleAgentLeaderboardHTML();

      // Self-learning endpoints (2026-04-16)
      if (path === '/api/agents/exemplars') return handleAgentExemplars(env.DB, url);
      if (path === '/api/agents/funnel') return handleAgentFunnel(env.DB, url, env);
      if (path === '/api/agents/named-first-seen') return handleAgentNamedFirstSeen(env.DB, url, env);

      // Agent enrichment endpoints
      if (path === '/api/needs-enrichment') return handleNeedsEnrichment(env.DB, url);
      if (path === '/api/enrichments/stats') return handleEnrichmentStats(env.DB);
      const enrichMatch = path.match(/^\/api\/enrich\/([a-z0-9-]+)$/);
      if (enrichMatch && request.method === 'POST') {
        const rl = checkRateLimit(request, 'write');
        if (rl) {
          // Log the rate-limited attempt so the digest's "tried-and-bounced"
          // funnel stage doesn't silently lose 429s.
          await logEnrichmentAttempt(env.DB, {
            slug: enrichMatch[1],
            ua: request.headers.get('User-Agent') || null,
            ip: request.headers.get('CF-Connecting-IP') || null,
            referrer: request.headers.get('Referer') || null,
            status_code: 429,
            error_class: 'rate_limited',
            fields_count: 0,
            payload_bytes: 0,
          });
          return rl;
        }
        return handleEnrich(env.DB, request, enrichMatch[1]);
      }
      // Method mismatch on a well-formed enrich path: log + 405.
      // Catches HEAD/OPTIONS/GET probes from agents that test endpoints
      // before POSTing. Without this, those probes look like /AGENTS.md
      // reads with no follow-up attempt.
      // GET on the enrich endpoint is a BRIEF, not an error (2026-09-04).
      //
      // WHY THIS CHANGED. The 30-day pull on 2026-09-04 found 98 of 103 write
      // attempts were `wrong_method_get`, against 3 successes. Every one of
      // those was an agent that found the endpoint and tried it, and every one
      // got 41 bytes back: {"error":"Method not allowed. POST only."} — no
      // slug echo, no field list, no example body. A 95% failure rate on the
      // one interaction the whole B2A design rests on.
      //
      // It was partly self-inflicted. The sitemap and AGENTS.md both print this
      // URL as plain text, and a sitemap is a document whose purpose is "fetch
      // these URLs", so anything following the link arrives by GET. Amazonbot
      // did it 24 times; an iPhone Safari UA did it 61 times.
      //
      // So GET now returns the enrichment state of that nonprofit: which fields
      // are empty, what is pending a second opinion, and the exact POST body to
      // send. 200, not 405, because this is now a legitimate read of the
      // resource's enrichment state rather than a rejected write.
      //
      // The attempt is STILL logged, with error_class `get_brief_served`, so
      // the conversion from brief to POST stays measurable. Do not drop that
      // logging: it is the only way to tell whether this change worked, and
      // the wrong_method_get counter that surfaced this problem was itself
      // added in migration 013 (2026-05-08) and then never read by any report
      // for 119 days.
      //
      // DEGRADE, DO NOT 500. buildEnrichmentBrief hand-writes a SELECT against
      // nonprofits and agent_enrichments. If a column name is ever wrong, or the
      // schema moves under it, this must fall back to the old 405 rather than
      // throw a 500 on a public endpoint. A brief is an improvement on an error;
      // a 500 is worse than the error we are replacing.
      if (enrichMatch && request.method === 'GET') {
        let brief = null;
        let briefFailed = false;
        try {
          brief = await buildEnrichmentBrief(env.DB, enrichMatch[1]);
        } catch (e) {
          briefFailed = true;
          console.error(`[Enrich] brief failed for ${enrichMatch[1]}: ${(e && e.message) || e}`);
        }
        if (briefFailed) {
          await logEnrichmentAttempt(env.DB, {
            slug: enrichMatch[1],
            ua: request.headers.get('User-Agent') || null,
            ip: request.headers.get('CF-Connecting-IP') || null,
            referrer: request.headers.get('Referer') || null,
            status_code: 405,
            error_class: 'get_brief_error',
            fields_count: 0,
            payload_bytes: 0,
          });
          return error('Method not allowed. POST or GET (for a submission brief).', 405);
        }
        await logEnrichmentAttempt(env.DB, {
          slug: enrichMatch[1],
          ua: request.headers.get('User-Agent') || null,
          ip: request.headers.get('CF-Connecting-IP') || null,
          referrer: request.headers.get('Referer') || null,
          status_code: brief ? 200 : 404,
          // 'get_brief_nonprofit_not_found', not 'nonprofit_not_found' (2026-09-07).
          // The POST path at handleEnrich logs a bare 'nonprofit_not_found' too, so
          // the two were indistinguishable in enrichment_attempts and any read-vs-write
          // split had to treat the class as ambiguous. Prefixing it here makes every
          // row logged from today forward attributable to the method that produced it,
          // with no schema change. Rows written before today stay ambiguous; there are
          // 6 of them and the read path buckets them explicitly rather than guessing.
          error_class: brief ? 'get_brief_served' : 'get_brief_nonprofit_not_found',
          fields_count: brief ? brief.missing_fields.length : 0,
          payload_bytes: 0,
        });
        if (!brief) {
          return error(
            `No nonprofit with slug "${enrichMatch[1]}". Browse GET /api/needs-enrichment for live targets.`,
            404
          );
        }
        return json(brief);
      }

      if (enrichMatch && request.method !== 'POST') {
        await logEnrichmentAttempt(env.DB, {
          slug: enrichMatch[1],
          ua: request.headers.get('User-Agent') || null,
          ip: request.headers.get('CF-Connecting-IP') || null,
          referrer: request.headers.get('Referer') || null,
          status_code: 405,
          error_class: `wrong_method_${request.method.toLowerCase()}`,
          fields_count: 0,
          payload_bytes: 0,
        });
        return error('Method not allowed. POST or GET (for a submission brief).', 405);
      }

      // x402 donate route — GET (returns 402) or POST (with X-PAYMENT settles)
      // Nonprofits without wallets get redirected to their existing donation URL
      const donateMatch = path.match(/^\/api\/donate\/([a-z0-9-]+)$/);
      if (donateMatch) {
        return handleDonate(env.DB, env, request, donateMatch[1]);
      }

      // Donation history route
      const donationHistoryMatch = path.match(/^\/api\/donations\/([a-z0-9-]+)$/);
      if (donationHistoryMatch) {
        return handleDonationHistory(env.DB, donationHistoryMatch[1]);
      }

      // Dynamic nonprofit route
      const nonprofitMatch = path.match(/^\/api\/nonprofits\/([a-z0-9-]+)$/);
      if (nonprofitMatch) {
        const allowPreview = url.searchParams.get('preview') === '1';
        return handleGetNonprofit(env.DB, nonprofitMatch[1], allowPreview);
      }

      // Donate page: /donate/{slug} → serve inline HTML (client-side JS reads the slug from URL)
      // Outbound donate click tracker. Must sit before the donate page match
      // so /out/<slug> is never swallowed by a broader route later.
      const outMatch = path.match(/^\/out\/([a-z0-9-]+)$/);
      if (outMatch) return handleOutboundDonate(env.DB, request, url, outMatch[1]);

      const donatePageMatch = path.match(/^\/donate\/([a-z0-9-]+)$/);
      if (donatePageMatch) {
        return new Response(DONATE_PAGE_HTML, {
          headers: { 'Content-Type': 'text/html;charset=UTF-8' },
        });
      }

      // Get started → redirect to onboard
      if (path === '/get-started') {
        return Response.redirect('https://giveready.org/onboard', 301);
      }

      // Before falling through to static assets / 404, capture any POST
      // that LOOKS like an enrichment attempt but didn't match the strict
      // route regex. Common misses: uppercase slug, trailing slash,
      // /api/enrich without a slug, /api/enrichments (plural typo) used
      // in some docs, and — observed in production 2026-05 — agents
      // passing the literal placeholder "{slug}" (or URL-encoded
      // "%7Bslug%7D") from doc prose verbatim. Branch the response so the
      // helpful cases get a 422 with a worked example, while genuinely
      // malformed paths still 404. Without this, those POSTs silently
      // 404 and the digest mistakes them for "agent never tried".
      if (request.method === 'POST' && /^\/api\/enrich(?:ments)?(?:\/|$)/i.test(path)) {
        // Read body once so we can both log it (Fix #3) and re-use it in
        // the response classification. Body read is best-effort — if the
        // stream fails we still log the attempt.
        let attemptBody = '';
        try {
          attemptBody = await request.text();
        } catch (_e) {
          attemptBody = '';
        }
        const attemptBytes = attemptBody ? new TextEncoder().encode(attemptBody).length : 0;
        const attemptContentType = request.headers.get('Content-Type') || null;
        const attemptUa = request.headers.get('User-Agent') || null;
        const attemptIp = request.headers.get('CF-Connecting-IP') || null;
        const attemptReferrer = request.headers.get('Referer') || null;

        // Detect literal-placeholder paths: /api/enrich/{slug},
        // /api/enrich/%7Bslug%7D (URL-encoded), /api/enrich/<slug>, or
        // any obvious "this is a placeholder, not a real slug" token.
        const placeholderRe =
          /^\/api\/enrich\/(?:\{slug\}|%7B(?:slug)%7D|<slug>|:slug|SLUG)\/?$/i;
        const isLiteralPlaceholder = placeholderRe.test(path);

        // Detect empty slug: /api/enrich, /api/enrich/, /api/enrichments,
        // /api/enrichments/. Agents that strip the placeholder entirely
        // land here.
        const isEmptySlug = /^\/api\/enrich(?:ments)?\/?$/i.test(path);

        if (isLiteralPlaceholder || isEmptySlug) {
          const helperBody = {
            error: 'placeholder_passed_literally',
            received_path: path,
            hint:
              isEmptySlug
                ? 'You POSTed to /api/enrich with no slug. The URL must include a real nonprofit slug, e.g. /api/enrich/finn-wardman-world-explorer-fund.'
                : 'You appear to have passed the placeholder "{slug}" (or a similar literal) from the documentation verbatim. Substitute it with a real nonprofit slug before sending.',
            example_curl:
              'curl -X POST https://giveready.org/api/enrich/finn-wardman-world-explorer-fund -H "Content-Type: application/json" -d \'{"field":"website","value":"https://EXAMPLE.org","source_url":"https://EXAMPLE.org/about","agent_id":"YOUR_AGENT_NAME","agent_name":"YOUR_AGENT_NAME"}\'',
            live_targets: 'https://giveready.org/api/needs-enrichment',
            full_protocol: 'https://giveready.org/AGENTS.md',
          };
          await logEnrichmentAttempt(env.DB, {
            slug: path,
            ua: attemptUa,
            ip: attemptIp,
            referrer: attemptReferrer,
            status_code: 422,
            error_class: isEmptySlug ? 'empty_slug' : 'placeholder_passed_literally',
            fields_count: 0,
            payload_bytes: attemptBytes,
            request_body: attemptBody,
            content_type: attemptContentType,
          });
          return json(helperBody, 422);
        }

        // Genuine bad path (uppercase slug, weird chars, /api/enrichments
        // plural typo with a real-looking slug, etc.) — still 404, but
        // with a cleaner hint that does NOT echo the {slug} pattern back
        // at the agent.
        await logEnrichmentAttempt(env.DB, {
          slug: path,
          ua: attemptUa,
          ip: attemptIp,
          referrer: attemptReferrer,
          status_code: 404,
          error_class: 'route_miss',
          fields_count: 0,
          payload_bytes: attemptBytes,
          request_body: attemptBody,
          content_type: attemptContentType,
        });
        return error(
          'Not found. POST to /api/enrich/<nonprofit-slug> with a lowercase hyphenated slug, e.g. /api/enrich/finn-wardman-world-explorer-fund. Live targets: https://giveready.org/api/needs-enrichment. Protocol: https://giveready.org/AGENTS.md.',
          404,
        );
      }

      // No API route matched — try serving a static asset
      if (env.ASSETS) {
        const assetResponse = await env.ASSETS.fetch(request);
        if (assetResponse.status !== 404) return assetResponse;
      }

      return error('Not found', 404);
    } catch (err) {
      console.error(err);
      return error('Internal server error', 500);
    }
  },
};

export default {
  // Hourly reconciliation. Donations paid straight from a donor's wallet never
  // reach the Worker, so the only way to know they happened is to look at the
  // chain. Failures are logged and swallowed: a reconciler fault must never be
  // able to take the site down.
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        const results = await reconcileAll(env.DB, env, null, false);
        const recorded = results.reduce((n, r) => n + r.recorded, 0);
        const failed = results.filter(r => r.error);
        console.log(`[Reconcile] ${results.length} wallets, ${recorded} donations recorded, ${failed.length} errors`);
        for (const f of failed) console.error(`[Reconcile] ${f.slug}: ${f.error}`);
      } catch (e) {
        console.error(`[Reconcile] run failed: ${e.message}`);
      }
    })());

    // AI traffic summary for the home page, every third hour (2026-09-24).
    // ~17k index rows per run, 8 runs a day. Independent try: it can never
    // block the reconciler or the daily housekeeping below.
    if (new Date(event.scheduledTime).getUTCHours() % 3 === 0) {
      ctx.waitUntil((async () => {
        try {
          const v = await refreshAiTraffic(env.DB);
          console.log(`[AiTraffic] ${v.total} AI visits to charity pages in 7d`);
        } catch (e) {
          console.error(`[AiTraffic] refresh failed: ${(e && e.message) || e}`);
        }
      })());
    }

    // ── Daily housekeeping ────────────────────────────────────────────────
    //
    // The cron fires hourly at :17 for the reconciler. This block runs on ONE
    // of those passes a day, not all 24. That distinction is the whole point:
    // the recount reads 41,227 rows, so hourly would cost 989k rows/day and be
    // worse than the bug it fixes.
    //
    // Added 2026-09-02 after D1 rows_read hit 99% of the 5,000,000/day free-tier
    // limit and the site returned 1101 on every database route for four hours.
    // See docs/DEPLOY-d1-rows-read-fix-2026-09-02.md.
    if (new Date(event.scheduledTime).getUTCHours() === 3) {
      // AI traffic, 30-day view for the home page (2026-09-24). Own try.
      ctx.waitUntil((async () => {
        try {
          const v = await refreshAiTraffic30d(env.DB);
          console.log(`[AiTraffic30d] ${v.total} visits, ${v.profiles_read} profiles`);
        } catch (e) {
          console.error(`[AiTraffic30d] refresh failed: ${(e && e.message) || e}`);
        }
      })());

      // STEP 1, LOAD-BEARING, RUNS FIRST AND ALONE.
      //
      // WHY THE ORDER AND THE SEPARATE try/catch MATTER (2026-09-03). The first
      // version of this block put the prune first and refreshDirectoryStats last
      // inside ONE try. The 03:17 UTC run on 2026-09-03 did not refresh the
      // stats: /api/stats still reported nonprofit_count_as_of from the manual
      // migration the previous morning, and discovery_hits_total was still null.
      // The prune threw, the shared catch swallowed it, and the recount below it
      // never ran.
      //
      // That is the dangerous failure, not the unpruned table. handleStats falls
      // back to the live COUNT(*) once the cached count is 48 hours old, so a
      // prune failure silently restores the exact 41,227-rows-per-request
      // behaviour that exhausted the daily quota and took the site down twice.
      // Retention is housekeeping; this recount is what keeps the site cheap.
      // Never make it downstream of anything that can fail.
      ctx.waitUntil((async () => {
        try {
          await refreshDirectoryStats(env.DB);
          console.log('[Housekeeping] directory stats recounted');
        } catch (e) {
          console.error(`[Housekeeping] STATS RECOUNT FAILED: ${(e && e.message) || e}`);
        }
      })());

      // STEP 2, housekeeping. Independent: it cannot take step 1 down with it.
      ctx.waitUntil((async () => {
        try {
          // RETENTION. Nothing reads discovery_hits beyond 30 days: the admin
          // windows top out at hours=720 and funnel-guides at 168. 90 days is a
          // 3x safety margin, and it is the number migration 008 intended when
          // it ran this DELETE exactly once, at migration time, and never again.
          // That one-off is why the table reached 240,779 rows by September.
          //
          // BOUNDED ON PURPOSE. The first version of this was one unbounded
          // DELETE. Run against the live database as migration 025 it returned
          // {"D1_RESET_DO":true} and rolled back: ~165,000 rows is a single
          // transaction large enough to restart the Durable Object behind D1.
          // Had it not failed there it would have failed here instead, inside a
          // cron with nobody watching, on its first run.
          //
          // PRUNE_BATCH x PRUNE_PASSES caps one nightly run. Steady state is
          // ~2,500 expiring rows a day, so this converges in one pass and the
          // cap only matters while a backlog exists. A backlog therefore drains
          // over several nights rather than in one dangerous transaction, which
          // is the correct trade: nothing breaks while the table is oversized.
          const PRUNE_BATCH = 2000;
          const PRUNE_PASSES = 5;
          let prunedHitRows = 0;
          for (let pass = 0; pass < PRUNE_PASSES; pass++) {
            const r = await env.DB.prepare(
              `DELETE FROM discovery_hits WHERE rowid IN (
                 SELECT rowid FROM discovery_hits
                  WHERE created_at < datetime('now', '-90 days') LIMIT ?1)`
            ).bind(PRUNE_BATCH).run();
            const changed = r.meta?.changes ?? 0;
            prunedHitRows += changed;
            if (changed < PRUNE_BATCH) break; // nothing left to do
          }
          const prunedQueries = await env.DB.prepare(
            `DELETE FROM query_log WHERE rowid IN (
               SELECT rowid FROM query_log
                WHERE created_at < datetime('now', '-90 days') LIMIT ?1)`
          ).bind(PRUNE_BATCH).run();

          // Recount AFTER the prune so the cached lifetime total describes the
          // table as it now stands rather than as it stood a moment ago. This
          // one is genuinely optional: a null here shows as null in the admin
          // response and nothing reads it.
          await env.DB.prepare(
            `INSERT OR REPLACE INTO stats_cache (key, value, updated_at)
             SELECT 'discovery_hits_total', CAST(COUNT(*) AS TEXT), datetime('now') FROM discovery_hits`
          ).run();

          // Rollup retention (migration 026, added 2026-09-17). Bounded by
          // construction rather than by traffic: tens of rows a day, so 400 days
          // is roughly 20k rows and there is no scenario where this needs
          // batching the way discovery_hits does. Kept long on purpose, because
          // the whole point of a counter is that year-over-year comparison stays
          // cheap. Buckets are 'YYYY-MM-DDTHH', so a string compare against a
          // formatted cutoff is the correct range test.
          const rollupCutoff = new Date(Date.now() - 400 * 86400 * 1000).toISOString().slice(0, 13);
          const prunedRollup = await env.DB.prepare(
            `DELETE FROM traffic_rollup WHERE bucket < ?1`
          ).bind(rollupCutoff).run().catch(() => null);
          await env.DB.prepare(
            `DELETE FROM traffic_geo WHERE bucket < ?1`
          ).bind(rollupCutoff).run().catch(() => null);

          console.log(
            `[Housekeeping] pruned ${prunedHitRows} discovery_hits, ` +
            `${prunedQueries.meta?.changes ?? '?'} query_log rows, ` +
            `${prunedRollup?.meta?.changes ?? 0} traffic_rollup rows`
          );
        } catch (e) {
          // Loud, because handleStats falls back to a live COUNT(*) after 48h of
          // this failing, which quietly restores the expensive behaviour.
          console.error(`[Housekeeping] FAILED: ${(e && e.message) || e}`);
        }
      })());
    }
  },

  async fetch(request, env, ctx) {
    // TRAFFIC ROLLUP (migration 026, added 2026-09-17). Counted here, at the
    // same single choke point the noStore() comment below describes, and for
    // the same reason: a route added later cannot quietly miss it.
    //
    // This is deliberately ABOVE the HEAD rewrite so a HEAD is counted once as
    // itself. The rewrite re-enters _httpHandler.handle(), not fetch(), so
    // there is no double count.
    //
    // waitUntil, never awaited: the counter must not add latency to a page and
    // must not be able to fail one. recordTraffic swallows its own errors into
    // TRAFFIC_ROLLUP_HEALTH.
    try {
      ctx.waitUntil(recordTraffic(
        env.DB,
        new URL(request.url).pathname,
        request.headers.get('User-Agent'),
        request.cf && request.cf.country
      ));
    } catch (e) {
      console.error('recordTraffic dispatch failed:', (e && e.message) || e);
    }

    // HEAD support: rewrite HEAD→GET, run the normal handler, then strip the
    // body before returning. This makes 2026-style discovery clients (which
    // HEAD before GET) see well-known and other discovery routes correctly.
    if (request.method === 'HEAD') {
      const getReq = new Request(request.url, {
        method: 'GET',
        headers: request.headers,
      });
      const r = await _httpHandler.handle(getReq, env, ctx);
      return new Response(null, {
        status: r.status,
        statusText: r.statusText,
        headers: r.headers,
      });
    }
    const res = await _httpHandler.handle(request, env, ctx);
    // Every /api/admin/* response is telemetry or control surface. None of it is
    // ever safe to cache. Applied here, at the single choke point, so a new admin
    // route cannot be added later and quietly miss the header. See noStore().
    if (new URL(request.url).pathname.startsWith('/api/admin/')) {
      return noStore(res);
    }
    return res;
  },
};
