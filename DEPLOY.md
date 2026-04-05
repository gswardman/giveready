# GiveReady — Deployment Guide

## Prerequisites

- Node.js 18+
- Wrangler CLI (`npm install -g wrangler`)
- Cloudflare account (you already have one)
- giveready.org domain pointed to Cloudflare

## Step 1: Create the D1 Database

```bash
cd giveready
wrangler d1 create giveready-db
```

This outputs a database ID. Copy it into `wrangler.toml` replacing `YOUR_DATABASE_ID_HERE`.

## Step 2: Run the Schema

```bash
# Local first (for testing)
wrangler d1 execute giveready-db --local --file=./schema.sql

# Then remote
wrangler d1 execute giveready-db --remote --file=./schema.sql
```

## Step 3: Seed the Data

```bash
# Local
wrangler d1 execute giveready-db --local --file=./seed.sql

# Remote
wrangler d1 execute giveready-db --remote --file=./seed.sql
```

## Step 4: Test Locally

```bash
npm install
wrangler dev
```

Test these URLs:
- http://localhost:8787/ — root info
- http://localhost:8787/api/nonprofits — list all
- http://localhost:8787/api/search?q=music — search
- http://localhost:8787/api/nonprofits/bridges-for-music — detail
- http://localhost:8787/api/causes — cause list
- http://localhost:8787/api/stats — stats
- http://localhost:8787/mcp — MCP manifest
- http://localhost:8787/.well-known/ai-plugin.json — AI plugin manifest

## Step 5: Deploy

```bash
wrangler deploy
```

## Step 6: Custom Domain

In the Cloudflare dashboard:
1. Go to Workers & Pages → giveready
2. Settings → Domains & Routes
3. Add custom domain: giveready.org
4. Cloudflare handles SSL automatically

## Step 7: Test the MCP Server

```bash
cd mcp-server
npm install
```

Add to your Claude Desktop or Claude Code config:

```json
{
  "mcpServers": {
    "giveready": {
      "command": "node",
      "args": ["/full/path/to/giveready/mcp-server/index.js"]
    }
  }
}
```

Restart Claude. Ask: "Search for youth music education nonprofits in South Africa."
It should return Bridges for Music with full impact data.

## Adding Nonprofits

For now, add nonprofits by writing INSERT statements in seed.sql and re-running.
Phase 2: build an onboarding form that generates the SQL or writes directly to D1.

## File Structure

```
giveready/
├── wrangler.toml          ← Cloudflare Worker config
├── package.json           ← Worker dependencies
├── schema.sql             ← D1 database schema
├── seed.sql               ← Nonprofit seed data
├── DEPLOY.md              ← You are here
├── src/
│   └── index.js           ← Cloudflare Worker (API)
├── public/
│   ├── llms.txt           ← AI crawler metadata
│   └── agents.md          ← Agent discovery file
└── mcp-server/
    ├── package.json       ← MCP server dependencies
    └── index.js           ← MCP server for AI assistants
```
