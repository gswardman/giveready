#!/usr/bin/env bash
# GiveReady — forensic read of charity activity BEFORE the onboarding
# instrumentation existed (migration 020, 2026-08-01).
#
# The question this answers: has anyone ever tried to sign up, sign in, or
# claim a charity page, in the months when nothing was logging it?
#
# There was no onboarding event log before 2026-08-01, but several tables have
# been quietly accumulating evidence the whole time and nothing has ever read
# them:
#
#   nonprofits.created_at   every row added since the bulk import
#   magic_link_tokens       EVERY sign-in ever requested, used or not
#   claim_requests          people asking for access to an existing page
#   charity_users           who actually holds access
#   registrations           EIN / charity numbers filed at signup
#   profile_edits           anyone who has edited a profile
#
# magic_link_tokens is the important one. A person who found the site, decided
# to claim their charity, and requested a link left a row there even if the
# rest of the path failed silently. That is the closest thing to a record of
# intent that exists.
#
# Read-only. Runs no writes. Requires wrangler auth.
#
# Usage: ./scripts/gr-history.sh

set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Anything at or before this is bulk-imported, not a signup.
IMPORT_CUTOFF="2026-04-12T23:59:59"

q() {  # $1 = heading, $2 = sql
  echo
  echo "── $1"
  npx wrangler d1 execute giveready-db --remote --command "$2" 2>/dev/null \
    || echo "   (query failed — check wrangler auth)"
}

echo
echo "GiveReady — pre-instrumentation activity trail"
echo "Anything after $IMPORT_CUTOFF is NOT from the bulk import."
echo "======================================================"

q "Nonprofits added since the import (the definitive signup record)" \
"SELECT slug, name, contact_email, country, verified, created_at
 FROM nonprofits
 WHERE created_at > '$IMPORT_CUTOFF'
 ORDER BY created_at DESC;"

q "Sign-in attempts, ever (intent, even where the path failed)" \
"SELECT email, created_at, used_at, ip_address
 FROM magic_link_tokens
 ORDER BY created_at DESC
 LIMIT 100;"

q "Sign-in attempts that were never completed (requested, never clicked)" \
"SELECT COUNT(*) AS never_used FROM magic_link_tokens WHERE used_at IS NULL;"

q "Claim requests (asked for access to an existing page)" \
"SELECT * FROM claim_requests ORDER BY created_at DESC LIMIT 50;"

q "Who currently holds dashboard access" \
"SELECT cu.email, n.slug, n.name, cu.created_at, cu.revoked_at
 FROM charity_users cu LEFT JOIN nonprofits n ON n.id = cu.nonprofit_id
 ORDER BY cu.created_at DESC;"

q "Registration numbers filed since the import" \
"SELECT r.registration_number, r.type, r.country, n.slug, n.created_at
 FROM registrations r JOIN nonprofits n ON n.id = r.nonprofit_id
 WHERE n.created_at > '$IMPORT_CUTOFF'
 ORDER BY n.created_at DESC;"

q "Profile edits ever made by a charity" \
"SELECT pe.field, pe.created_at, n.slug
 FROM profile_edits pe LEFT JOIN nonprofits n ON n.id = pe.nonprofit_id
 ORDER BY pe.created_at DESC LIMIT 50;"

q "Reconciliation: does the live count match the frozen cache?" \
"SELECT
   (SELECT COUNT(*) FROM nonprofits) AS live_total,
   (SELECT COUNT(*) FROM nonprofits WHERE verified = 1) AS live_verified,
   (SELECT value FROM stats_cache WHERE key = 'nonprofit_count') AS cached_total,
   (SELECT value FROM stats_cache WHERE key = 'verified_count') AS cached_verified;"

echo
echo "======================================================"
echo "  Reading the result:"
echo "  - a row in nonprofits with a NON-EMPTY contact_email and a created_at"
echo "    after the cutoff is a genuine self-registration"
echo "  - an empty contact_email is an operator or import addition"
echo "  - magic_link_tokens rows for addresses you do not recognise are people"
echo "    who tried to get in and, before 2026-08-01, left no other trace"
echo
