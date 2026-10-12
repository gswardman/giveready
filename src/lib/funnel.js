/**
 * GiveReady — Onboarding funnel instrumentation (migration 020).
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

import { sha256Hex } from './crypto.js';
import { emailDomain } from './validation.js';

// ============================================
// ONBOARDING FUNNEL INSTRUMENTATION (migration 020)
// ============================================
//
// One append-only row per step of the charity path, success or failure.
// Added 2026-08-01 after four faults on that path went months undetected
// because a failed registration left no trace anywhere.
//
// Non-negotiable property: this must never be able to break the request it
// is measuring. Every call is fire-and-forget with a swallowed error. An
// instrumentation bug that 500s a charity signup would be worse than the
// blindness it is fixing.
export async function logOnboardingEvent(db, step, fields = {}) {
  try {
    const email = (fields.email || '').trim().toLowerCase();
    const actorHash = email ? (await sha256Hex(email)).slice(0, 16) : null;
    await db.prepare(`
      INSERT INTO onboarding_events
        (id, step, outcome, nonprofit_id, slug, actor_hash, email_domain, reason, user_agent)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
    `).bind(
      crypto.randomUUID(),
      step,
      fields.outcome || 'ok',
      fields.nonprofit_id || null,
      fields.slug || null,
      actorHash,
      email ? emailDomain(email) : null,
      fields.reason ? String(fields.reason).slice(0, 500) : null,
      fields.user_agent ? String(fields.user_agent).slice(0, 300) : null
    ).run();
  } catch (e) {
    // Deliberately swallowed. A log write failing is not worth a 500.
    console.error(`[funnel] log failed for step=${step}: ${e && e.message}`);
  }
}
