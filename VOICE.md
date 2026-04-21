---
name: geordie-email
description: Draft informal emails, Slack messages, and DMs in Geordie Wardman's natural voice. ALWAYS trigger when Geordie says "draft an email to", "write a note to", "reply to", "send a quick message to", "write a short message to", or asks to draft outbound informal correspondence. The voice is conversational, slightly unpolished, with lowercase "i", dash-separated greetings, minor typos and run-ons, and concrete proof points. NEVER use this voice for grant applications, contracts, MOUs, or formal professional documents.
---

# Geordie Email Voice — Draft Outbound Correspondence Like Geordie

## Purpose

When Geordie asks for a draft email, Slack, DM, or short informal message,
match his natural writing style. Output should read like him typing fast,
not like a polished AI email.

## Voice rules (MUST follow)

- Lowercase greeting: `hi Joe` or `hi [name]`. Never `Hey`, `Hi`, `Hello`, or comma.
- Dash separator after greeting: `hi Joe -` or `hi Joe --`. Never comma.
- Lowercase first-person pronoun: `i`, not `I`. This is the single biggest
  signal that the email is really from Geordie and not from an AI.
- Lowercase day names: `monday`, `tuesday`. Never `Monday`.
- Use ` -- ` (double dash) for asides and pauses. NEVER use em-dashes (—).
- No sign-off word. Not `Cheers,`, not `Best,`, not `Regards,`. Just
  `Geordie` on a line by itself.
- No numbered or bulleted lists in informal emails. Use flowing paragraphs
  separated by blank lines.

## Style rules (strongly prefer)

- Do not over-polish. Minor typos are fine: `platfform`, `teh`, `mos` (for
  months), `non profs` (for nonprofits).
- Missing apostrophes are OK: `donors reasons`, `its` for `it's`.
- Run-on sentences and comma-splice style are natural.
- A floating period mid-sentence is fine occasionally: `important 6 mos and
  beyond as. you can imagine`.
- Trailing thoughts or URL drops at the end of a paragraph are fine: `we
  can walk through how https://v3.squads.so/connect-squad`.
- Paragraph lengths do NOT need to be balanced. A one-line paragraph next
  to a four-line paragraph is natural.

## Content moves Geordie makes (copy these patterns)

- Warm opener that acknowledges effort or thought: `i had a few moments to
  think through some of your questions`.
- Invite collaboration rather than demand action: `feel free to give some
  comments even this weekend`.
- Add concrete proof points to technical claims: `I've already built in a
  self learning mechanism and i check the logs daily and update the code.
  This is in place now.`
- Market / competitive framing: `Currently, there's no charity platform
  that does this`. `those AI chats will be able to find you, and not just
  always suggest the big UK non profs`.
- Reader-equity framing: `you'll be able to get equal or even higher
  footing based on the donors reasons to want to give`.
- Assume the logistics are handled: `I already sent the invite. so looking
  forward to chatting on monday.` Don't re-negotiate timing.

## Anti-patterns (what to AVOID in Geordie's voice)

- Capital `I` for first person
- `Hey [Name],` greeting
- Em-dashes (—) anywhere
- Numbered or bulleted lists in informal messages
- `Cheers, [Name]` or any sign-off word
- Opening like `Quick answers here` / `Quick answers below` (too AI-structural)
- `Let's grab 30 min` as a demand when the invite is already sent
- Perfect grammar (reads as AI-generated)
- Balanced, rhythmic paragraph lengths (reads as edited)
- Closing CTA with specific time slots (e.g. `Monday 2pm or 4pm UK?`)
  unless Geordie explicitly asks for one

## When NOT to use this voice

- Grant applications, formal contracts, MOUs
- LinkedIn posts for a business audience
- Outward client-facing professional documents (TestVentures scopes of work)
- Anything going to a lawyer, accountant, regulator, or grant committee
- External PR / press releases

Use polished English in those contexts.

## Workflow when Geordie asks for a draft

1. Understand who the recipient is and what the ask is. If unclear, ask once.
2. Draft in Geordie's voice using every rule above.
3. Read the draft back. If it feels too polished, dirty it up: add a small
   typo, lowercase a day name, drop a comma, run two sentences together.
4. Deliver the draft with NO preamble like `Here's a draft:`. Just the
   email body so Geordie can copy-paste.
5. After the draft, offer up to two optional tweaks only if there are real
   choices (e.g. `tease the offer vs name the number`). Never more than two.

## Calibration examples

### Over-polished AI version (bad)

```
Hey Joe,

Thanks for the notes, all fair questions. Quick answers here, then let's
grab 30 min on Monday to go deeper.

1) On the AI learning piece. Today, agents discover you automatically via
a machine-readable profile you don't have to build or maintain. Over time,
their query signals sharpen how you show up.

[...]

Monday 2pm or 4pm UK for 30 min?

Cheers,
Geordie
```

### Geordie natural version (good)

```
hi Joe - i had a few moments to think through some of your questions.
feel free to give some comments even this weekend and I can prepare for
our call --

On the AI learning piece. Today in our platfform agents discover you
automatically via a machine-readable profile you don't have to build or
maintain. Currently, there's no charity platform that does this, and it's
going to become hugely important 6 mos and beyond as. you can imagine.

Over time, their query signals sharpen how you show up. The "page learns"
bit is real but on a longer arc than I probably made it sound. I've
already built in a self learning mechanism and i check the logs daily and
update the code. This is in place now.

[...]

I already sent the invite. so looking forward to chatting on monday.
Geordie
```

Note the differences: lowercase greeting, dash separator, lowercase `i`
for first person, warm opener, concrete proof points, competitive
framing, flowing paragraphs, small typos left in, lowercase `monday`, no
`Cheers,` sign-off.

## Deployment

This file is formatted as a valid Claude skill. To activate it so Claude
automatically uses this voice whenever Geordie asks for a draft:

1. Move this file to `~/.claude/skills/geordie-email/SKILL.md`
2. Or run the `skill-creator` skill to formalise it

Until then, this file serves as a durable style reference. Read it before
drafting any email for Geordie.
