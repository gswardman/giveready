#!/usr/bin/env bash
# add-guide-crawl-endpoint.sh
# Adds the read-only /api/admin/guide-crawl endpoint to src/index.js.
# Idempotent, anchored (no line numbers), backs up before touching anything,
# and syntax-checks the result. Does NOT deploy — review the diff, then run
# giveready/deploy.sh yourself.
#
# Usage:
#   bash scripts/add-guide-crawl-endpoint.sh            # patch + syntax check
#   REPO=/path/to/giveready bash add-guide-crawl-endpoint.sh
set -euo pipefail

REPO="${REPO:-/Users/papamac2025/TestVentures.net/giveready}"
IDX="$REPO/src/index.js"

[ -f "$IDX" ] || { echo "ERROR: not found: $IDX"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- handler snippet (literal; quoted heredoc, nothing expands) --------------
cat > "$TMP/handler.txt" <<'HANDLER_EOF'
// ---------------------------------------------------------------------------
// GET /api/admin/guide-crawl?hours=720&token=...
// Per-guide, per-bot crawl recency over the /guides/* routes. Read-only over
// discovery_hits (no migration). Added 2026-07-16 to make the crawl-then-cite
// lag measurable per guide instead of via the 30d PerplexityBot aggregate.
// ---------------------------------------------------------------------------
async function handleGuideCrawl(db, env, request, url) {
  const authCheck = checkAdminAuth(env, request);
  if (authCheck) return authCheck;

  const hours = parseInt(url.searchParams.get('hours') || '720'); // 30d default
  const since = `datetime('now', '-${hours} hours')`;

  const rows = (await db.prepare(
    `SELECT route, user_agent, COUNT(*) AS hits, MAX(created_at) AS last_seen
       FROM discovery_hits
      WHERE route LIKE '/guides/%'
        AND created_at > ${since}
        AND user_agent IS NOT NULL
      GROUP BY route, user_agent`
  ).all()).results;

  const classify = (ua) => {
    const hit = KNOWN_AGENT_PATTERNS.find((e) => ua.includes(e.pattern));
    return hit ? { name: hit.name, type: hit.type } : { name: 'other', type: 'other' };
  };

  const guides = {};
  for (const r of rows) {
    const g = (guides[r.route] ||= { route: r.route, perplexity_last_crawl: null, crawls: {} });
    const c = classify(r.user_agent);
    const cur = (g.crawls[c.name] ||= { type: c.type, hits: 0, last_seen: null });
    cur.hits += r.hits;
    if (!cur.last_seen || r.last_seen > cur.last_seen) cur.last_seen = r.last_seen;
    if (/perplex/i.test(r.user_agent)) {
      if (!g.perplexity_last_crawl || r.last_seen > g.perplexity_last_crawl) {
        g.perplexity_last_crawl = r.last_seen;
      }
    }
  }

  return json({
    period: `last ${hours} hours`,
    guides: Object.values(guides).sort((a, b) =>
      (a.perplexity_last_crawl || '').localeCompare(b.perplexity_last_crawl || '')),
  });
}

HANDLER_EOF

# --- route dispatch snippet (literal) ----------------------------------------
cat > "$TMP/route.txt" <<'ROUTE_EOF'
      if (path === '/api/admin/guide-crawl') {
        return handleGuideCrawl(env.DB, env, request, url);
      }
ROUTE_EOF

# --- backup ------------------------------------------------------------------
BAK="$IDX.bak.$(date +%Y%m%d-%H%M%S)"
cp "$IDX" "$BAK"
echo "Backup: $BAK"

# --- patch (Node, anchored, idempotent, $-safe replacement) ------------------
IDX="$IDX" HANDLER_FILE="$TMP/handler.txt" ROUTE_FILE="$TMP/route.txt" node <<'NODE'
const fs = require('fs');
const idx = process.env.IDX;
let s = fs.readFileSync(idx, 'utf8');

if (s.includes('handleGuideCrawl(')) {
  console.log('Already patched — no change made.');
  process.exit(0);
}

const handler = fs.readFileSync(process.env.HANDLER_FILE, 'utf8');
const route   = fs.readFileSync(process.env.ROUTE_FILE, 'utf8');

const routeAnchor   = "      if (path === '/api/admin/drafts') {";
const handlerAnchor = "async function handleAdminTraffic(db, env, request, url) {";

if (!s.includes(routeAnchor))   { console.error('ABORT: route anchor not found.');   process.exit(1); }
if (!s.includes(handlerAnchor)) { console.error('ABORT: handler anchor not found.'); process.exit(1); }

// Function-form replacement so $ in the snippets is never interpreted.
s = s.replace(routeAnchor,   () => route + routeAnchor);
s = s.replace(handlerAnchor, () => handler + handlerAnchor);

fs.writeFileSync(idx, s);
console.log('Patched: /api/admin/guide-crawl route + handleGuideCrawl handler inserted.');
NODE

# --- syntax check ------------------------------------------------------------
if node --check "$IDX"; then
  echo "Syntax OK."
else
  echo "Syntax check FAILED — restoring backup."
  cp "$BAK" "$IDX"
  exit 1
fi

echo
echo "Done. Review the change:"
echo "  git -C \"$REPO\" diff -- src/index.js"
echo "Then deploy via your normal path:"
echo "  cd \"$REPO\" && ./deploy.sh"
echo
echo "Smoke test after deploy (token from .secrets/giveready.env):"
echo "  curl -s \"https://www.giveready.org/api/admin/guide-crawl?hours=720&token=\$TOKEN\" | jq ."
