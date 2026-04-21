# GiveReady

Open-source infrastructure for AI agents to discover youth nonprofits and send them money directly. No intermediary. No platform fees. Nonprofits keep 100%.

## The Problem

Every donation platform — Every.org, The Giving Block, Endaoment — is an intermediary. Money goes to them first. They convert it, route it, take a cut. For small youth charities in Cape Town or Bermuda or Nairobi, that layer adds friction, fees, and delays that eat into already thin budgets.

Within 12 months, donors won't go to a website to give. They'll tell an AI assistant "find me a youth charity in Cape Town and send them $20." The agent needs structured data to find the right org and a payment rail to send the money. No existing platform provides both.

## What GiveReady Does

**Discovery.** An MCP server and REST API give AI agents structured access to 162+ youth nonprofits — programmes, impact metrics, beneficiary demographics, wallet addresses. When an AI agent needs to find a charity, it queries GiveReady.

**Direct payment.** The x402 protocol lets AI agents send USDC straight to the nonprofit's own wallet. No intermediary holds the funds. The nonprofit controls the money from the moment it arrives. Settlement in under a second on Solana.

**Embeddable donate button.** Every onboarded nonprofit gets a zero-dependency JavaScript widget for their website. One script tag. Generates a Solana Pay QR code or direct transfer link. Donors scan with Phantom or Coinbase Wallet. No backend required. No platform fee.

Discovery without payment is a search engine. Payment without discovery is a wallet. A donate button nobody can find is a widget. GiveReady combines all three.

## Why It Matters Outside the US/UK/EU

Traditional donation platforms route through US payment infrastructure. If you're banking in Bermuda, most of Africa, the Caribbean, or Southeast Asia, you're either excluded or paying conversion fees that make small donations pointless.

USDC on Solana works anywhere. A nonprofit needs a smartphone and a wallet app. Zero KYC to receive funds. Off-ramp to local currency through a local exchange if needed. This isn't just infrastructure for Western charities — it's infrastructure for any nonprofit in any country.

## Architecture

```
giveready/
├── src/index.js              # Cloudflare Worker — API + x402 endpoint
├── mcp-server/               # MCP server for AI agents (Claude, etc.)
├── public/
│   ├── index.html            # Landing page (static, served by Cloudflare)
│   ├── widget/               # Embeddable donate button (zero dependencies)
│   ├── llms.txt              # LLM crawler metadata
│   ├── AGENTS.md             # Agent discovery guide
│   └── openapi.json          # OpenAPI spec for ai-plugin.json
├── test-client/              # x402 payment protocol test client
├── scripts/                  # Data import utilities
├── schema.sql                # D1 database schema
├── seed.sql                  # Nonprofit seed data
├── deploy.sh                 # Deployment script (./deploy.sh)
└── wrangler.toml             # Cloudflare Workers config
```

**Stack:** Cloudflare Workers + D1 (SQLite) + Solana USDC + x402 protocol + Model Context Protocol (MCP)

**Cost to run:** ~$5/month on Cloudflare. Coinbase facilitator free tier covers 1,000 transactions/month. Transaction fees paid by donor.

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/search?q=&cause=&country=` | Search nonprofits |
| `GET /api/nonprofits` | List all verified nonprofits |
| `GET /api/nonprofits/:slug` | Get nonprofit detail |
| `GET /api/causes` | List cause areas |
| `GET /api/stats` | Directory statistics |
| `GET /api/donate/:slug?amount=` | x402 donation (returns 402 with payment requirements) |
| `POST /api/donate/:slug` | Submit signed payment |
| `GET /api/donations/:slug` | Donation history |
| `GET /mcp` | MCP server manifest |
| `GET /.well-known/ai-plugin.json` | AI plugin discovery |
| `GET /llms.txt` | LLM crawler metadata |
| `GET /agents.md` | Agent discovery guide |

## MCP Server

Install the MCP server to give any AI assistant native access to GiveReady:

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

Tools: `search_nonprofits`, `get_nonprofit`, `list_causes`, `submit_enrichment`

## Donate Widget

Add a donate button to any nonprofit website with one line:

```html
<div id="giveready-donate" data-slug="your-nonprofit-slug"></div>
<script src="https://giveready.org/widget/donate.js"></script>
```

See `public/widget/README.md` for full documentation.

## Run Your Own Instance

```bash
git clone https://github.com/gswardman/giveready.git
cd giveready
npm install
wrangler d1 create giveready-db
# Copy database_id into wrangler.toml
wrangler d1 execute giveready-db --local --file=./schema.sql
wrangler d1 execute giveready-db --local --file=./seed.sql
npm run dev
```

See `DEPLOY.md` for full production deployment instructions.

## Nonprofit Onboarding

Getting listed takes under 45 minutes:

1. **Set up a wallet** (3 min) — Download Phantom (Solana) or Coinbase Wallet. Copy the USDC address.
2. **Register on GiveReady** (10 min) — Org name, mission, programmes, impact data, wallet address.
3. **Optional: fiat off-ramp** (30 min) — Connect to a local exchange (Coinbase, Luno, etc.) if you want auto-conversion to local currency.
4. **Embed donate button** (2 min) — One script tag on your website.

The nonprofit is now discoverable by every AI agent on the internet, payable via x402, and has a fee-free donation button on their site.

## The Consortium

Grant lead: TestVentures.net. Platform operator: Clean Tactile Ventures UK Ltd. Pilot nonprofits for the 2026 Gates application:

**City Kids Surfing** — UK youth surf charity. Named design partner. Receives lifetime free access to the GiveReady donation platform (fiat via Stripe Connect and USDC via x402). Live pilot for real donation flow.

**Finn Wardman World Explorer Fund** — Youth adventure grants. Bermuda-based endowment. Internal pilot (eat-your-own-cooking). [finnwardman.com](https://finnwardman.com)

## About

GiveReady is built by [TestVentures.net](https://testventures.net) — fractional AI ops for youth nonprofits. Revenue from GiveReady's live directory supports the [Finn Wardman World Explorer Fund](https://finnwardman.com).

Finn Wardman died on April 8, 2023. He was 20. He was a freeride skier, a surfer, and one of the funniest people in any room. The World Explorer Fund exists so other young people get to have the kind of adventures he lived for. GiveReady exists so that fund — and hundreds of small nonprofits like it — can receive donations from anywhere in the world without an intermediary taking a cut.

## Licence

MIT. See `LICENSE`.
