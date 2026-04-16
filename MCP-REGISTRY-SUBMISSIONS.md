# GiveReady MCP Registry Submission Cheat Sheet

> **SUPERSEDED 2026-04-15** by the `publish-mcp-server` skill at `<vault>/.claude/skills/publish-mcp-server/SKILL.md`.
> Kept here as the canonical manual fallback if the skill ever fails, and as historical reference for the original push. New rollouts should invoke the skill, not follow this doc.

**Status (as of 2026-04-15):** 6 directories live or submitted (Official Registry, npm, mcpservers.org, Glama, PulseMCP, mcp.so). Smithery deferred — needs HTTP/remote transport.
**Original goal:** Get listed on 5+ directories. **Hit and exceeded.**

---

## Copy-Paste Fields (use across all submissions)

**Name:** giveready-mcp

**One-liner:** Open infrastructure that makes 41,000+ nonprofits discoverable, improvable, and payable by AI agents.

**Short description (under 200 chars):**
Search 41,000+ verified nonprofits across 29 cause areas, submit enrichments back to thin profiles, and donate via x402 + USDC on Solana. Zero fees — 100% reaches the nonprofit.

**Full description:**
GiveReady is open giving infrastructure for AI agents. It provides a verified directory of 41,000+ nonprofits across 29 cause areas — from mental health to environmental conservation to youth empowerment.

AI agents can search nonprofits by keyword, cause, or country; retrieve full profiles with mission, programmes, impact metrics, and legal registrations; enrich thin profiles via a write-back tool (submit_enrichment — structured fields auto-promote on 2-agent consensus, prose queues for committee review); and initiate USDC donations on Solana via the x402 payment protocol.

Every submitting agent gets public credit on the leaderboard at https://giveready.org/agents. Zero fees on donations. 100% of funds reach the nonprofit. No intermediary.

**GitHub:** https://github.com/gswardman/giveready

**npm:** giveready-mcp

**Install command:** `npx giveready-mcp`

**Website:** https://giveready.org

**Docs:** https://docs.giveready.org

**API base:** https://giveready.org/api

**Author:** TestVentures.net

**License:** MIT

**Tags/keywords:** nonprofit, charity, donation, giving, philanthropy, x402, USDC, Solana, impact-data, enrichment, b2a, verified-directory, cause-areas, ai-agent

**Tools provided:**
- `search_nonprofits` — Search 41,000+ verified nonprofits by keyword, cause area, or country
- `get_nonprofit` — Full nonprofit profile with mission, programmes, impact metrics, and donation URL
- `list_causes` — Browse all 29 cause areas with nonprofit counts
- `submit_enrichment` — Contribute missing data back to thin nonprofit profiles. Structured fields (website, city, region, founded_year, contact_email) auto-promote on 2-agent consensus; prose fields queue for committee review. Public leaderboard credit.

**Resources provided:**
- `giveready://stats` — Directory statistics (nonprofit count, countries, causes, beneficiaries)

**MCP config snippet:**
```json
{
  "mcpServers": {
    "giveready": {
      "command": "npx",
      "args": ["giveready-mcp"]
    }
  }
}
```

---

## 1. Smithery (smithery.ai)

**How:** CLI-based submission.

**Steps:**
1. Install Smithery CLI: `npm install -g @anthropic-ai/smithery`
2. Run: `smithery mcp publish "https://giveready.org" -n gswardman/giveready`
3. If that doesn't work, check https://smithery.ai/docs for current submission flow — they may also accept GitHub repo URLs directly

**Time:** ~5 minutes

---

## 2. Glama (glama.ai)

**How:** Submit via their directory at https://glama.ai/mcp/servers

**Steps:**
1. Go to https://glama.ai/mcp/servers
2. Look for "Submit" or "Add Server" button
3. Paste GitHub repo URL: https://github.com/gswardman/giveready
4. Glama has an automated quality scoring system — our server.json and README should score well
5. Fill in any additional fields from the copy-paste section above

**Notes:** Glama hosts MCP servers for users, so they may auto-index from npm. Check if `giveready-mcp` already appears by searching first.

**Time:** ~5 minutes

---

## 3. mcp.so

**How:** GitHub issue or web form.

**Steps:**
1. Go to https://mcp.so
2. Click "Submit" button (if visible)
3. Or: find their GitHub repo and open an issue requesting listing
4. Include: name, GitHub URL, npm package, one-liner description, and tools list from above

**Time:** ~5 minutes

---

## 4. mcpservers.org

**How:** Web form at https://mcpservers.org/submit

**Steps:**
1. Go to https://mcpservers.org/submit
2. Fill in form fields using the copy-paste section above
3. Submit

**Time:** ~3 minutes

---

## 5. awesome-mcp-servers (GitHub PR)

**How:** Pull request to https://github.com/wong2/awesome-mcp-servers

**Steps:**
1. Fork https://github.com/wong2/awesome-mcp-servers
2. Edit README.md — add GiveReady under the appropriate category (likely "Data" or "Productivity")
3. Add this line in alphabetical order within the section:

```markdown
- [giveready-mcp](https://github.com/gswardman/giveready) - Search 41,000+ verified nonprofits across 29 cause areas with impact data, donation links, and agent enrichment.
```

4. Open PR with title: "Add giveready-mcp — nonprofit discovery and donation server"
5. PR description:

```
Adds giveready-mcp, an MCP server for nonprofit discovery and AI-powered giving.

- 41,000+ verified nonprofits across 29 cause areas
- Search by keyword, cause, country
- Full profiles with impact metrics, programmes, legal registrations
- USDC donations via x402 protocol
- Agent enrichment write-back endpoints
- npm: giveready-mcp
- Already listed on Official MCP Registry as io.github.gswardman/giveready
```

**Time:** ~10 minutes (requires GitHub login)

---

## 6. PulseMCP (pulsemcp.com)

**How:** Check https://www.pulsemcp.com/servers — may auto-index from npm/GitHub.

**Steps:**
1. Search for "giveready" at https://www.pulsemcp.com/servers
2. If not listed, look for submission form or contact info
3. PulseMCP maintains the official registry too, so our existing listing may already feed into their index

**Time:** ~3 minutes to check

---

## Before You Start — Publish 0.1.4 (submit_enrichment tool live)

Version 0.1.4 adds the `submit_enrichment` tool and updates tool descriptions to reflect 41K nonprofits / 29 causes. package.json, server.json, and the McpServer constructor are all aligned to 0.1.4. Ship before hitting any directory:

```bash
# 1. Publish to npm
cd ~/TestVentures.net/giveready/mcp-server
npm publish

# 2. Republish to the Official MCP Registry
./mcp-publisher publish

# 3. Commit + push the whole upgrade
cd ~/TestVentures.net/giveready
git add mcp-server/index.js mcp-server/package.json mcp-server/server.json mcp-server/README.md README.md MCP-REGISTRY-SUBMISSIONS.md
git commit -m "MCP server 0.1.4: submit_enrichment tool, 41K/29 causes descriptions"
git push origin main

# 4. Verify
npm view giveready-mcp version    # expect 0.1.4
npx giveready-mcp --help 2>&1 | head -5   # sanity check the binary runs
```

The directory submissions assume 0.1.4 is live on npm — a few directories cache the tool list on first crawl, so publishing first keeps the listing accurate from day one.

---

## Priority Order

1. **awesome-mcp-servers** — highest visibility, backlink from 40K+ star repo
2. **Smithery** — largest MCP directory, CLI makes it fast
3. **Glama** — hosts servers, good quality scoring
4. **mcp.so** — community directory
5. **mcpservers.org** — quick form
6. **PulseMCP** — check if auto-indexed

Total estimated time: 30 minutes for all six.
