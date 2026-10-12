# GiveReady: Magic Link Verification Plan

## The Problem

Anyone can claim any nonprofit's page right now. There's no ownership verification. The backend logs the claim and says "we'll verify within 48 hours" but there's no actual verification mechanism. Meanwhile, Stripe gateway donations accumulate in GiveReady's account with no automated way to release them.

## The Solution: Domain-Verified Magic Links

Three layers, each progressively stronger:

### Layer 1: Email Domain Match (automatic, instant)

When someone claims a page, check if their email domain matches the nonprofit's known website domain.

- The Wave Project's website is `waveproject.co.uk`
- Claimant emails from `joe@waveproject.co.uk` → **strong match** → fast-track
- Claimant emails from `joe@gmail.com` → **no match** → requires manual review

This is exactly what Stripe Connect, Google Search Console, and Facebook Business Manager do. If you control the org's email domain, you almost certainly represent the org.

### Layer 2: Magic Link Email Verification (automatic, minutes)

After claiming, we send a magic link to the provided email. Clicking it proves the claimant controls that email address.

**Flow:**

```
1. Claimant fills out claim form → submits email
2. Backend generates a random token (crypto.randomUUID)
3. Token stored in new `verification_tokens` table with 24-hour expiry
4. Email sent with link: https://giveready.org/verify?token={token}
5. Claimant clicks link → token validated → nonprofit marked as verified
```

**Email sending:** Use Resend (resend.com). Free tier = 100 emails/day = more than enough. Single API call from the Worker. No SMTP config needed. Alternative: Cloudflare Email Workers (but Resend is simpler and has better deliverability).

### Layer 3: Charity Registry Cross-Check (automatic, seconds)

You already have `handleVerifyRegistration` that checks the UK Charity Commission API. Wire it into the claim flow:

- Claimant provides their charity registration number
- We check the national registry API (UK Charity Commission, US IRS EIN, etc.)
- If the registered name matches the nonprofit in our DB → confirmed
- Store the registry verification result alongside the claim

**Supported registries (existing + planned):**

| Country | Registry | API | Status |
|---------|----------|-----|--------|
| UK | Charity Commission | Free API | Already built |
| US | IRS EIN / ProPublica | Free API | Easy to add |
| South Africa | NPO Directorate | No public API | Manual |
| Bermuda | Registrar of Companies | No public API | Manual |

## Verification Tiers (What Gets Unlocked)

| Tier | Requirements | What It Unlocks |
|------|-------------|-----------------|
| **Unverified** | Just submitted claim | Nothing. Claim is pending. Page unchanged. |
| **Email Verified** | Clicked magic link | Profile edits go live. Listed as "claimed." |
| **Domain Verified** | Email domain matches org website | Full trust. Can set up payment methods. |
| **Registry Verified** | Charity number confirmed via API | Badge shown on profile. Donors see "verified." |

Domain + Registry = fully verified. No manual review needed.
Email only (gmail/hotmail) = flagged for admin review before going live.

## Database Changes

### New table: `verification_tokens`

```sql
CREATE TABLE IF NOT EXISTS verification_tokens (
  id TEXT PRIMARY KEY,
  nonprofit_id TEXT NOT NULL,
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL DEFAULT 'claim',  -- 'claim' or 'update'
  domain_match INTEGER DEFAULT 0,         -- 1 if email domain matches org website
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  FOREIGN KEY (nonprofit_id) REFERENCES nonprofits(id)
);
CREATE INDEX idx_verification_token ON verification_tokens(token);
```

### Alter `nonprofits` table

```sql
ALTER TABLE nonprofits ADD COLUMN verification_status TEXT DEFAULT 'unverified';
-- Values: 'unverified', 'email_verified', 'domain_verified', 'registry_verified'

ALTER TABLE nonprofits ADD COLUMN claimed_by_email TEXT;
ALTER TABLE nonprofits ADD COLUMN claimed_at TEXT;
ALTER TABLE nonprofits ADD COLUMN registry_number TEXT;
ALTER TABLE nonprofits ADD COLUMN registry_verified INTEGER DEFAULT 0;
```

## New API Endpoints

### POST /api/claim/{slug}
Replaces the current claim logic inside /api/onboard.

```
Request: { email, registry_number? }

1. Validate email format
2. Check if nonprofit exists and isn't already claimed
3. Check domain match: extract domain from email, compare to nonprofit's website domain
4. Generate verification token (crypto.randomUUID), store with 24h expiry
5. Send magic link email via Resend
6. If registry_number provided, verify against national registry API
7. Return: { success, message: "Check your email for verification link", domain_match }
```

### GET /api/verify?token={token}
The magic link landing.

```
1. Look up token in verification_tokens
2. Check not expired (24h window)
3. Check not already used
4. Mark token as used (used_at = now)
5. Update nonprofit: verification_status based on domain_match + registry check
6. If domain matched → 'domain_verified'
7. If no domain match → 'email_verified' (flagged for admin review)
8. Redirect to success page with next steps
```

### POST /api/admin/verify/{slug}
Manual admin verification for edge cases.

```
Admin can override verification_status to any tier.
For nonprofits where email domain doesn't match (small orgs using gmail etc.)
```

## Email Template

Subject: "Verify your GiveReady page — {org_name}"

```
Hi,

Someone (hopefully you) is claiming the {org_name} page on GiveReady.

Click below to verify your email and activate your page:

[Verify my page →]  https://giveready.org/verify?token={token}

This link expires in 24 hours.

If you didn't request this, you can safely ignore this email.

— GiveReady
Making small nonprofits discoverable.
```

## Resend Integration

```js
// In wrangler.toml (add as secret, not var):
// wrangler secret put RESEND_API_KEY

async function sendVerificationEmail(email, orgName, token, env) {
  const verifyUrl = `https://giveready.org/verify?token=${token}`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'GiveReady <verify@giveready.org>',
      to: [email],
      subject: `Verify your GiveReady page — ${orgName}`,
      html: `...template above...`,
    }),
  });

  return response.ok;
}
```

Cost: Free up to 100 emails/day on Resend. More than enough.
DNS: Add Resend's SPF/DKIM records to giveready.org in Cloudflare.

## Updated Claim Flow (User Experience)

```
Step 1: Search → find charity → click "Claim this page"

Step 2: Enter your org email + optional enrichment data
        [Domain match indicator shown: "✓ Email matches org website" or "⚠ We'll need to verify manually"]
        → Submit

Step 3: "Check your email" screen
        → Claimant clicks magic link in email
        → Redirected to success page

Step 4 (if domain matched): Page is live. Set up payments.
Step 4 (if no domain match): "Your claim is under review. We'll email you within 48 hours."
```

## What About Held Stripe Funds?

This plan doesn't change the Stripe payment flow yet — that's a separate piece. But once a nonprofit is **domain_verified** or **registry_verified**, the admin knows the claim is legit and can release held gateway_donations via Stripe dashboard (or eventually Stripe Connect for automated payouts).

Future improvement: wire Stripe Connect so verified nonprofits get their own connected account and held funds transfer automatically on verification. But that's a later build.

## Implementation Order

1. Create `verification_tokens` table (D1 migration)
2. Add columns to `nonprofits` table (D1 migration)
3. Sign up for Resend, add API key as wrangler secret, configure DNS
4. Build `POST /api/claim/{slug}` endpoint with domain matching + token generation + email sending
5. Build `GET /api/verify?token={token}` endpoint with verification page
6. Update `onboard.html` step 2 to show domain match indicator and simplified flow
7. Wire registry verification into claim flow (UK already built, just needs connecting)
8. Add admin override endpoint for manual verification

Estimated build time: 2-3 hours for the core flow (steps 1-6). Registry wiring and admin polish can follow.
