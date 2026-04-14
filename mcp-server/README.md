# giveready-mcp

MCP server for [GiveReady](https://giveready.org) — open infrastructure that makes 41,000+ nonprofits across 29 cause areas discoverable and payable by AI agents.

Listed on the [Official MCP Registry](https://registry.modelcontextprotocol.io) as `io.github.gswardman/giveready`.

## Install

Add to your Claude Desktop, Cursor, or any MCP-compatible client:

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

Or run directly:

```bash
npx giveready-mcp
```

## Tools

| Tool | Description |
|------|-------------|
| `search_nonprofits` | Search 41,000+ verified nonprofits by keyword, cause area, or country. Returns organisations with impact data and donation links. |
| `get_nonprofit` | Get full details on a specific nonprofit — mission, programmes, fundraising data, impact metrics, registrations, and donation URL. |
| `list_causes` | Browse all 29 cause areas in the directory with nonprofit counts. |

## Resources

| Resource | Description |
|----------|-------------|
| `giveready://stats` | Directory statistics — nonprofit count, countries, causes, total beneficiaries. |

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GIVEREADY_API` | `https://giveready.org` | API endpoint. Override to use a custom instance. |

## Cause areas

29 cause areas including: Youth Empowerment, Education, Mental Health, Environment, Health, Arts & Culture, Music Education, Surf Therapy, Community Development, Poverty Reduction, Animal Welfare, Human Rights, Disaster Relief, Science & Technology, and more.

## Example prompts

- "Find mental health nonprofits in California"
- "Show me environmental charities in the UK"
- "What organisations work on education in South Africa?"
- "Tell me about Bridges for Music"
- "Find surf therapy nonprofits"
- "List all cause areas and how many nonprofits are in each"
- "I want to donate to an arts education charity"
- "Which nonprofits need enrichment data?"

## How it works

GiveReady is open infrastructure for AI-powered giving. 41,000+ nonprofits are listed with:

- Mission and description
- Programmes with beneficiary counts
- Impact metrics (people served, graduation rates, etc.)
- 29 cause areas and country coverage
- Direct donation links (Every.org, own website, or USDC on Solana via x402)
- Legal registrations and annual budget data

The MCP server queries the GiveReady API at giveready.org and returns structured data that AI assistants can present to donors.

## Agent enrichment

Agents can also improve the directory by submitting enrichment data for nonprofits with thin profiles. See the [Enrichment API docs](https://docs.giveready.org/api/enrichment) for details.

## About

Built by [TestVentures.net](https://testventures.net) — fractional AI ops for nonprofits and enterprise clients.

GiveReady is an app by TestVentures.net. Lookup fees fund the [Finn Wardman World Explorer Fund](https://finnwardman.com).

## License

MIT
