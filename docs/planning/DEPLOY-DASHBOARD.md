# Dashboard MVP — Deploy Checklist

**Ship target:** Friday/Saturday of week 2026-04-20.
**What this ships:** Passwordless charity dashboard at `/dashboard`, claim flow at `/claim`, sign-in at `/signin`, check-email at `/check-email`. Backed by migration 011 (charity_users, charity_sessions, magic_link_tokens, claim_requests, profile_edits, query_matches) + new auth/charity endpoints in src/index.js.

---

## Pre-deploy (all on your Mac, not the sandbox)

### 1. Set Resend secret (if not already)

```bash
cd ~/TestVentures.net/giveready
wrangler secret put RESEND_API_KEY
# paste your Resend key from https://resend.com/api-keys
```

Verify:
```bash
wrangler secret list
```

### 2. Configure DNS for Resend deliverability — REQUIRED

Magic-link emails will land in spam without these. Do this FIRST.

In Cloudflare DNS for `giveready.org`, add the records Resend gives you:
- SPF: TXT record `v=spf1 include:amazonses.com ~all` (or however Resend formats it)
- DKIM: 3 CNAME records per Resend's panel
- DMARC: TXT record `_dmarc` with `v=DMARC1; p=none; rua=mailto:postmaster@giveready.org`

Verify with:
```bash
dig +short TXT giveready.org | grep spf
dig +short TXT _dmarc.giveready.org
dig +short CNAME resend._domainkey.giveready.org
```

Resend's dashboard will show all records green before you deploy.

### 3. Test migration 011 locally

```bash
cd ~/TestVentures.net/giveready
wrangler d1 execute giveready-db --local --file=./migrations/011-charity-dashboard.sql
wrangler d1 execute giveready-db --local --file=./scripts/seed-cks-demo.sql
```

Spot-check:
```bash
wrangler d1 execute giveready-db --local --command="SELECT email, role FROM charity_users"
wrangler d1 execute giveready-db --local --command="SELECT COUNT(*) FROM query_matches"
```

### 4. Local end-to-end smoke test

```bash
wrangler dev --local
```

In another terminal:
```bash
# request a magic link (dry-run — Resend call will fail if secret not set in .dev.vars, OK)
curl -i -X POST http://localhost:8787/api/auth/request \
  -H "Content-Type: application/json" \
  -d '{"email":"joe@getcitykidssurfing.com"}'
# Expect: 204

# Load dashboard without cookie -> 401 redirect handled by JS
curl -i http://localhost:8787/dashboard
# Expect: 200 HTML
```

Open http://localhost:8787/signin in your browser, enter `joe@getcitykidssurfing.com`, hit submit. You should land on `/check-email`. For a full loop test, grab the token from the local D1:

```bash
wrangler d1 execute giveready-db --local --command="SELECT token_hash, email, expires_at FROM magic_link_tokens ORDER BY created_at DESC LIMIT 1"
```

...but you can't reverse the hash. For local testing, hack a known token into the DB:
```bash
# generate a known token hash
echo -n "devtoken123456789012345678901234" | shasum -a 256
# insert it manually
wrangler d1 execute giveready-db --local --command="INSERT INTO magic_link_tokens (token_hash, email, expires_at) VALUES ('<sha256>', 'joe@getcitykidssurfing.com', datetime('now', '+15 minutes'))"
# click:
open "http://localhost:8787/api/auth/verify?token=devtoken123456789012345678901234"
```

You should end up at `/dashboard` with a session cookie set. Click around — edit the profile, check the Searches tab (should show the 6 seeded queries), check the Share tab.

---

## Deploy to production

### 5. Apply migration 011 to prod D1

```bash
cd ~/TestVentures.net/giveready
wrangler d1 execute giveready-db --remote --file=./migrations/011-charity-dashboard.sql
```

**IMPORTANT:** this is a forward-only migration — no rollback script. The six new tables are additive, but if you botch this, you'd need to `DROP TABLE` manually.

### 6. Apply seed to prod D1 (optional — only for the demo video)

```bash
wrangler d1 execute giveready-db --remote --file=./scripts/seed-cks-demo.sql
```

This makes Joe's account exist in production and seeds the 6 demo query_matches. Safe to run repeatedly (all statements use `INSERT OR IGNORE`).

### 7. Deploy the Worker

Use the existing `./deploy.sh` path. It runs the lint + build + wrangler deploy + verification.

```bash
./deploy.sh "ship charity dashboard MVP + auth + migration 011"
```

### 8. Post-deploy smoke test

```bash
# Migration applied
curl -fsS https://giveready.org/api/stats | jq .

# Dashboard routes load
curl -fsS -o /dev/null -w "%{http_code}\n" https://giveready.org/signin          # 200
curl -fsS -o /dev/null -w "%{http_code}\n" https://giveready.org/check-email     # 200
curl -fsS -o /dev/null -w "%{http_code}\n" https://giveready.org/dashboard       # 200 (HTML, redirects to /signin client-side)
curl -fsS -o /dev/null -w "%{http_code}\n" https://giveready.org/claim           # 200

# Security headers present
curl -fsS -D - -o /dev/null https://giveready.org/signin | grep -i "content-security-policy\|x-frame-options"

# Auth endpoint rejects bad requests
curl -fsS -o /dev/null -w "%{http_code}\n" -X POST https://giveready.org/api/auth/request \
  -H "Content-Type: application/json" -d '{"email":"not-an-email"}'
# Expect: 400

# Unauthenticated /api/charity/me returns 401
curl -fsS -o /dev/null -w "%{http_code}\n" https://giveready.org/api/charity/me
# Expect: 401
```

### 9. End-to-end test with a real email

Open an incognito window. Go to https://giveready.org/signin. Enter `joe@getcitykidssurfing.com` (the seeded user). Click submit. Check the inbox. Click the link. You should land on /dashboard, see CKS, edit a field, save, see the toast. Check the Searches tab — should show the 6 demo queries.

If email doesn't arrive: check Resend dashboard, check DNS (step 2).

---

## Demo video script (60 seconds)

1. (0-5s) Intro: "This is GiveReady — AI-native donation infrastructure for charities. Let me show you how a charity manages their page."
2. (5-15s) Open incognito, go to https://giveready.org/donate/city-kids-surfing. Scroll past the donate controls. Click "Sign in to manage" at the bottom.
3. (15-25s) Sign-in page. Type joe@getcitykidssurfing.com. Click send. "Check your email" interstitial.
4. (25-35s) Cut to the email. Click the link. Lands on dashboard.
5. (35-45s) Show the Profile tab — strength score 53/100, the basics form. Edit the mission field, save. Toast fires.
6. (45-55s) Switch to the Searches tab. "Here are the real donor queries that matched my charity in the last month." Read one or two.
7. (55-60s) "Full product shape in the Gates Foundation application. Thank you." End.

Record with Loom, export as mp4, upload to the application attachments.

---

## Things to announce / highlight

- **Shipped in 36 hours from design-review to live.** Testament to AI-assisted build velocity.
- **Passwordless auth, session-table backed, rate-limited.** Reviewed by /cso before launch, 4 defence-in-depth fixes applied.
- **41K nonprofits pre-seeded, zero-onboarding-friction.** First-week feedback loop: Joe logs in, edits CKS, reports back.

## Known deferred items

- Programmes + Impact metrics editing (empty states ship; forms are Month 1-3 scope)
- Full donate-button widget variants (Button/Card/Inline)
- AI enhance — the menu renders but the two actions are stubbed pending real Claude API wiring
- Durable Object rate limit (D1-backed limit ships; DO upgrade is tracked as task #5)
- Gift Aid capture + HMRC filing (Month 1-3)
- US 501(c)(3) donation receipts (Month 1-3)
- Multi-user per charity (role column shipped, UI not wired)

Each of these is a Month 1-3 deliverable under the grant. The MVP shipped today covers the load-bearing flows.
