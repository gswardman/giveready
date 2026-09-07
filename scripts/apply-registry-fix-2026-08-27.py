#!/usr/bin/env python3
"""
apply-registry-fix-2026-08-27.py

One-shot patcher for src/index.js. Written in Cowork on 2026-08-27, applied and
deployed from the Mac.

WHY A SCRIPT AND NOT A HAND EDIT
src/index.js is 8,400 lines and has very long lines. Every replacement below
asserts it matched exactly once and aborts the whole run otherwise, so a partial
patch cannot land. Idempotent: re-running after a successful patch is a no-op
and reports so.

WHAT IT CHANGES
1. handleSearch      — adds verified / registry_status / safe_to_recommend /
                       checked_within_hours filters, returns registry columns.
2. handleListNonprofits — honours `page` and `country`, both of which were
                       accepted and silently ignored.
3. handleRegistryEins   — NEW. Bulk join keys for the daily IRS check.
4. handleRegistryRevoked — NEW. Public list of organisations that lost status.
5. Routes for the two new endpoints.

Run from the giveready repo root:
    python3 scripts/apply-registry-fix-2026-08-27.py
    node --check src/index.js
"""

import re
import sys
import pathlib

SRC = pathlib.Path("src/index.js")
if not SRC.exists():
    sys.exit("Run this from the giveready repo root (src/index.js not found).")

text = SRC.read_text(encoding="utf-8")
original = text

MARKER = "handleRegistryEins"
if MARKER in text:
    print("Already patched (handleRegistryEins present). Nothing to do.")
    sys.exit(0)

changes = []


def sub_once(old, new, label):
    global text
    n = text.count(old)
    if n != 1:
        sys.exit(f"ABORT [{label}]: anchor matched {n} times, expected exactly 1.\n"
                 f"--- anchor ---\n{old}\n--------------")
    text = text.replace(old, new, 1)
    changes.append(label)


# ---------------------------------------------------------------------------
# 1. handleSearch: registry and verified filters
# ---------------------------------------------------------------------------

sub_once(
    """  const ghd = url.searchParams.get('ghd_aligned');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);""",
    """  const ghd = url.searchParams.get('ghd_aligned');

  // Trust filters (2026-08-27). Until today `verified=1` was accepted and
  // ignored: it returned the unfiltered default page, so a caller asking for
  // verified organisations got unverified ones and no way to tell. Silent
  // ignore is worse than 400, because the caller acts on the result.
  const verifiedOnly = ['1', 'true'].includes(String(url.searchParams.get('verified')));
  const registryStatusFilter = url.searchParams.get('registry_status');
  const safeOnly = ['1', 'true'].includes(String(url.searchParams.get('safe_to_recommend')));
  // Freshness in hours. `safe_to_recommend=1&checked_within_hours=24` is the
  // query an agent should send before telling a human where to send money.
  const checkedWithinHours = parseInt(url.searchParams.get('checked_within_hours') || '0');
  const checkedSince = checkedWithinHours > 0
    ? Math.floor(Date.now() / 1000) - (checkedWithinHours * 3600)
    : null;

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);""",
    "handleSearch: parse trust filters",
)

REGISTRY_COLS_FTS = """               n.founded_year, n.annual_budget_usd, n.logo_url, n.verified,
               n.region, n.description,
               n.registry_status, n.registry_status_source,
               n.registry_status_source_date, n.registry_status_checked_at"""

sub_once(
    """               n.founded_year, n.annual_budget_usd, n.logo_url, n.verified,
               n.region, n.description
        FROM nonprofits n
        JOIN nonprofits_fts fts ON n.rowid = fts.rowid""",
    REGISTRY_COLS_FTS + """
        FROM nonprofits n
        JOIN nonprofits_fts fts ON n.rowid = fts.rowid""",
    "handleSearch FTS: select registry columns",
)

sub_once(
    """      if (ghd === '1' || ghd === 'true') {
        query += ` AND n.ghd_aligned = 1`;
      }

      query += ` ORDER BY rank LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`;""",
    """      if (ghd === '1' || ghd === 'true') {
        query += ` AND n.ghd_aligned = 1`;
      }
      if (verifiedOnly) {
        query += ` AND n.verified = 1`;
      }
      if (safeOnly) {
        query += ` AND n.registry_status = 'good_standing'`;
      } else if (registryStatusFilter) {
        query += ` AND n.registry_status = ?${params.length + 1}`;
        params.push(registryStatusFilter);
      }
      if (checkedSince !== null) {
        query += ` AND n.registry_status_checked_at >= ?${params.length + 1}`;
        params.push(checkedSince);
      }

      query += ` ORDER BY rank LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`;""",
    "handleSearch FTS: apply trust filters",
)

FILTER_ECHO = """{ q, cause, country, ghd_aligned: ghd === '1' || ghd === 'true',
                 verified: verifiedOnly, registry_status: registryStatusFilter,
                 safe_to_recommend: safeOnly,
                 checked_within_hours: checkedWithinHours || null }"""

sub_once(
    """        query: { q, cause, country, ghd_aligned: ghd === '1' || ghd === 'true' },""",
    f"""        query: {FILTER_ECHO},""",
    "handleSearch FTS: echo filters",
)

sub_once(
    """           n.founded_year, n.annual_budget_usd, n.logo_url, n.verified,
           n.region, n.description
    FROM nonprofits n
    LEFT JOIN nonprofit_causes nc ON n.id = nc.nonprofit_id""",
    """           n.founded_year, n.annual_budget_usd, n.logo_url, n.verified,
           n.region, n.description,
           n.registry_status, n.registry_status_source,
           n.registry_status_source_date, n.registry_status_checked_at
    FROM nonprofits n
    LEFT JOIN nonprofit_causes nc ON n.id = nc.nonprofit_id""",
    "handleSearch LIKE: select registry columns",
)

sub_once(
    """  if (ghd === '1' || ghd === 'true') {
    query += ` AND n.ghd_aligned = 1`;
  }

  query += ` ORDER BY n.beneficiaries_per_year DESC LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`;""",
    """  if (ghd === '1' || ghd === 'true') {
    query += ` AND n.ghd_aligned = 1`;
  }
  if (verifiedOnly) {
    query += ` AND n.verified = 1`;
  }
  if (safeOnly) {
    query += ` AND n.registry_status = 'good_standing'`;
  } else if (registryStatusFilter) {
    query += ` AND n.registry_status = ?${params.length + 1}`;
    params.push(registryStatusFilter);
  }
  if (checkedSince !== null) {
    query += ` AND n.registry_status_checked_at >= ?${params.length + 1}`;
    params.push(checkedSince);
  }

  query += ` ORDER BY n.beneficiaries_per_year DESC LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`;""",
    "handleSearch LIKE: apply trust filters",
)

sub_once(
    """    query: { q, cause, country, ghd_aligned: ghd === '1' || ghd === 'true' },""",
    f"""    query: {FILTER_ECHO},""",
    "handleSearch LIKE: echo filters",
)


# ---------------------------------------------------------------------------
# 2 + 3 + 4. handleListNonprofits rewrite, plus the two new endpoints
# ---------------------------------------------------------------------------

OLD_LIST = """async function handleListNonprofits(db, url) {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  const results = await db.prepare(`
    SELECT id, slug, name, tagline, mission, country, city, region, website,
           donation_url, logo_url, beneficiaries_per_year, founded_year,
           ghd_aligned, verified, description
    FROM nonprofits
    ORDER BY verified DESC, beneficiaries_per_year DESC
    LIMIT ?1 OFFSET ?2
  `).bind(limit, offset).all();

  const total = await db.prepare(
    `SELECT COUNT(*) as count FROM nonprofits`
  ).first();

  return json({
    total: total.count,
    count: results.results.length,
    nonprofits: results.results,
  });
}"""

NEW_LIST = r"""async function handleListNonprofits(db, url) {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);

  // `page` was accepted and silently ignored until 2026-08-27. page=1, page=5
  // and page=20 all returned the identical first record, so any paging caller
  // read the same 100 rows forever and had no way to notice. Accept both now;
  // an explicit offset wins.
  const page = Math.max(parseInt(url.searchParams.get('page') || '1'), 1);
  const offset = url.searchParams.has('offset')
    ? Math.max(parseInt(url.searchParams.get('offset') || '0'), 0)
    : (page - 1) * limit;

  // `country` was ignored the same way: the unfiltered total came back for
  // every value, which reads as "41,227 organisations in Bermuda".
  const country = url.searchParams.get('country');

  // ORDER BY was not a total order, so OFFSET paging could repeat or skip rows
  // wherever verified and beneficiaries_per_year tied. `id` makes it stable.
  const sql = `
    SELECT id, slug, name, tagline, mission, country, city, region, website,
           donation_url, logo_url, beneficiaries_per_year, founded_year,
           ghd_aligned, verified, description,
           registry_status, registry_status_source_date, registry_status_checked_at
    FROM nonprofits
    ${country ? 'WHERE LOWER(country) = LOWER(?3)' : ''}
    ORDER BY verified DESC, beneficiaries_per_year DESC, id
    LIMIT ?1 OFFSET ?2
  `;
  const results = await (country
    ? db.prepare(sql).bind(limit, offset, country)
    : db.prepare(sql).bind(limit, offset)).all();

  const total = await (country
    ? db.prepare(`SELECT COUNT(*) as count FROM nonprofits WHERE LOWER(country) = LOWER(?1)`).bind(country)
    : db.prepare(`SELECT COUNT(*) as count FROM nonprofits`)).first();

  const rows = results.results || [];
  return json({
    total: total.count,
    count: rows.length,
    limit,
    offset,
    next_offset: (offset + rows.length) < total.count ? offset + rows.length : null,
    nonprofits: rows,
  });
}

/**
 * GET /api/registry/eins?cursor=&limit=
 *
 * Bulk join keys for the daily registry check. Deliberately thin: id, slug,
 * ein, country, current status. No mission text, no description.
 *
 * WHY THIS EXISTS (2026-08-27)
 * check-irs-revocations.js read EINs off /api/nonprofits, which does not return
 * the registrations array. Only the single-profile endpoint does. So the daily
 * job downloaded 77MB of IRS data every morning, parsed 1.2M revoked and 1.4M
 * exempt EINs correctly, then joined them against an empty list. Five runs,
 * zero matches, and it logged "no updates to apply" rather than an error. A
 * check that cannot fail loudly is not a check.
 *
 * TWO SOURCES FOR THE KEY, in this order:
 *   1. registrations.registration_number_normalised. The real record.
 *   2. nonprofits.id. The Every.org import minted IDs as 'every-<EIN>', so
 *      roughly 86% of the directory carries its EIN in the primary key.
 *      Confirmed on live records: every-460923905 has registration 460923905.
 * `ein_source` reports which path produced the value, so if assumption 2 is
 * ever wrong it is auditable rather than silent.
 *
 * ZERO PADDING. Migration 024 backfilled the normalised column with digits only
 * and did not pad. An EIN with a leading zero therefore sits at 8 characters
 * while the IRS files are 9 wide, and the join would miss it. Pad here.
 *
 * CONFLICTING EINs. A few records carry two different numbers (yescarolina has
 * both 203562766 and 461710691). MIN() picks one deterministically. That is a
 * data problem to fix upstream, not here, but a deterministic wrong answer is
 * at least reproducible.
 *
 * US REGISTRATIONS ONLY, and this matters. UK charity numbers are 6 to 8
 * digits: bridges-for-music carries 1154170, which pads to 001154170 and would
 * then be looked up in the IRS files as if it were an EIN. A chance collision
 * would publish a US tax status against a UK charity. Filter on the
 * registration's own country and type, never on digit length.
 */
async function handleRegistryEins(db, url) {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '1000'), 5000);
  const cursor = url.searchParams.get('cursor') || '';

  const results = await db.prepare(`
    SELECT n.id, n.slug, n.country, n.registry_status,
           COALESCE(reg.ein, idein.ein) AS ein,
           CASE WHEN reg.ein IS NOT NULL THEN 'registrations'
                WHEN idein.ein IS NOT NULL THEN 'id_pattern'
                ELSE NULL END AS ein_source,
           -- Both raw values, always. Where a record has both, they should
           -- agree; every disagreement is a record where we would publish a tax
           -- status derived from a guess. Returning only the COALESCE would
           -- make that unmeasurable, which is how the original bug survived.
           reg.ein AS ein_registrations,
           idein.ein AS ein_id_pattern
      FROM nonprofits n
      LEFT JOIN (
        SELECT nonprofit_id,
               MIN(substr('000000000' || registration_number_normalised, -9, 9)) AS ein
          FROM registrations
         WHERE registration_number_normalised IS NOT NULL
           AND length(registration_number_normalised) BETWEEN 8 AND 9
           AND (country = 'United States' OR type LIKE '501(c)%')
         GROUP BY nonprofit_id
      ) reg ON reg.nonprofit_id = n.id
      LEFT JOIN (
        SELECT id AS nid, substr(id, 7) AS ein
          FROM nonprofits
         WHERE id GLOB 'every-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
      ) idein ON idein.nid = n.id
     WHERE n.id > ?1
       AND COALESCE(reg.ein, idein.ein) IS NOT NULL
     ORDER BY n.id
     LIMIT ?2
  `).bind(cursor, limit).all();

  const rows = results.results || [];
  return json({
    count: rows.length,
    next_cursor: rows.length === limit ? rows[rows.length - 1].id : null,
    nonprofits: rows,
  });
}

/**
 * GET /api/registry/revoked?limit=
 *
 * Organisations in this directory that appear on the IRS auto-revocation list,
 * with the evidence attached. Public and linkable on purpose: a list of
 * charities that lost tax-exempt status and are still listed as fine elsewhere
 * does not exist in this form anywhere else.
 *
 * 'revoked' and 'revoked_reinstated' are returned in SEPARATE arrays and must
 * stay separate. On the list AND back in the current exempt file is a fact
 * about the past. Merging the two would publish an accusation against a charity
 * that is currently in good standing, which is the exact failure migration 024
 * rule 2 exists to prevent.
 */
async function handleRegistryRevoked(db, url) {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200'), 1000);

  const results = await db.prepare(`
    SELECT slug, name, country, registry_status, registry_status_source,
           registry_status_source_date, registry_status_checked_at,
           registry_revoked_at
      FROM nonprofits
     WHERE registry_status IN ('revoked', 'revoked_reinstated')
     ORDER BY registry_status, registry_revoked_at DESC, slug
     LIMIT ?1
  `).bind(limit).all();

  const rows = (results.results || []).map((r) => ({
    ...r,
    url: `https://www.giveready.org/nonprofits/${r.slug}`,
  }));

  return json({
    count: rows.length,
    revoked: rows.filter((r) => r.registry_status === 'revoked'),
    reinstated: rows.filter((r) => r.registry_status === 'revoked_reinstated'),
    notes: [
      'revoked = on the IRS auto-revocation list AND absent from the current Pub 78 exempt file.',
      'reinstated = on the list BUT present in the current exempt file. Currently exempt. Not a warning.',
      'The IRS leaves organisations on the revocation list after reinstatement, so list membership alone proves nothing.',
      'Organisations are never deleted from this directory. A flagged page with a date is more useful to an agent than a 404.',
    ],
  });
}"""

sub_once(OLD_LIST, NEW_LIST, "handleListNonprofits + two new handlers")


# ---------------------------------------------------------------------------
# 5. Routes
# ---------------------------------------------------------------------------

sub_once(
    """      if (path === '/api/nonprofits') return handleListNonprofits(env.DB, url);""",
    """      if (path === '/api/nonprofits') return handleListNonprofits(env.DB, url);
      if (path === '/api/registry/eins') return handleRegistryEins(env.DB, url);
      if (path === '/api/registry/revoked') return handleRegistryRevoked(env.DB, url);""",
    "routes",
)


SRC.write_text(text, encoding="utf-8")
print(f"Patched {SRC} ({len(original)} -> {len(text)} bytes)")
for c in changes:
    print(f"  ok  {c}")
print("\nNow run:  node --check src/index.js")
