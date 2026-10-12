/**
 * GiveReady — Input validation and normalisation helpers for the charity onboarding path.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

// Helper: generate slug from name
export function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // remove non-word chars except spaces and hyphens
    .replace(/\s+/g, '-') // spaces to hyphens
    .replace(/-+/g, '-') // collapse multiple hyphens
    .replace(/^-+|-+$/g, ''); // trim hyphens from edges
}

// Helper: validate email loosely
export function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// Solana addresses are base58-encoded 32-byte public keys: 32-44 chars,
// no 0/O/I/l. This is a shape check, not an on-chain existence check —
// it catches paste errors and ETH addresses, which is what we see in
// practice. A wrong-but-well-formed address is still possible, which is
// why usdc_wallet only goes live behind verified = 1.
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export function isValidSolanaAddress(addr) {
  return typeof addr === 'string' && SOLANA_ADDRESS_RE.test(addr.trim());
}

// The 41k bulk-imported rows store full country names. The onboarding form
// used to post ISO-ish codes, which made every self-registered charity
// invisible to country filters. Normalise on the way in.
const COUNTRY_ALIASES = {
  US: 'United States', USA: 'United States', 'U.S.': 'United States',
  UK: 'United Kingdom', GB: 'United Kingdom', 'U.K.': 'United Kingdom',
  SA: 'South Africa', ZA: 'South Africa',
  CA: 'Canada', AU: 'Australia', NZ: 'New Zealand', IE: 'Ireland',
  DE: 'Germany', FR: 'France', NL: 'Netherlands', CH: 'Switzerland',
  KE: 'Kenya', NG: 'Nigeria', IN: 'India',
};
export function normaliseCountry(input) {
  const raw = (input || '').trim();
  if (!raw) return raw;
  return COUNTRY_ALIASES[raw.toUpperCase()] || raw;
}

// Helper: extract domain from email
export function emailDomain(email) {
  return (email || '').split('@')[1]?.toLowerCase() || '';
}

// Helper: extract domain from URL
export function urlDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}
