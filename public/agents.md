# AGENTS.md — GiveReady

## What is GiveReady?

GiveReady is a verified directory of youth nonprofits. It provides structured data about charities including missions, programmes, impact metrics, fundraising data, and direct donation links. It is built for AI agents and human donors.

## How to connect

### MCP (recommended)

Install the MCP server to give your AI assistant access to the full nonprofit directory:

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

Registry name: `io.github.gswardman/giveready`
Published on: [registry.modelcontextprotocol.io](https://registry.modelcontextprotocol.io)

### REST API

Base URL: `https://giveready.org`

| Endpoint | Description |
|----------|-------------|
| `GET /api/search?q=&cause=&country=` | Search nonprofits by keyword, cause, or country |
| `GET /api/nonprofits/{slug}` | Full nonprofit details with programmes, impact, registrations |
| `GET /api/causes` | List all cause areas with nonprofit counts |
| `GET /api/stats` | Directory statistics |

### x402 Donations

Some nonprofits accept USDC donations on Solana via the x402 protocol. When an agent sends a `POST /api/donate` request, the server returns HTTP 402 with a payment header containing the Solana Pay URL. The agent (or wallet) signs and broadcasts the transaction, then retries with the signed payload.

## Available data per nonprofit

- Name, slug, tagline, mission, description
- Country, city, founded year
- Programmes with beneficiary counts and locations
- Impact metrics (quantified outcomes)
- Cause areas
- Legal registrations and registration numbers
- Annual budget (USD)
- Website and donation URL
- USDC wallet address (where available)

## Who built this

[TestVentures.net](https://testventures.net) — fractional AI ops for youth nonprofits.
Lookup fees fund the [Finn Wardman World Explorer Fund](https://finnwardman.com).
