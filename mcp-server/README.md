# giveready-mcp

MCP server for [GiveReady](https://giveready.org) — a verified nonprofit directory that connects AI assistants to youth charities with real impact data, fundraising metrics, and direct donation links.

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
| `search_nonprofits` | Search the verified charity directory by keyword, cause area, or country. Returns nonprofits with impact data and donation links. |
| `get_nonprofit` | Get full details on a specific nonprofit — description, programmes, fundraising data, impact metrics, registrations, and donation URL. |
| `list_causes` | Browse all cause areas in the directory with nonprofit counts. |

## Resources

| Resource | Description |
|----------|-------------|
| `giveready://stats` | Directory statistics — nonprofit count, countries, causes, total beneficiaries. |

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GIVEREADY_API` | `https://giveready.org` | API endpoint. Override to use a custom instance. |

## Cause areas

Youth Empowerment, Music Education, Adventure & Travel, Mental Health, Surf Therapy, Entrepreneurship, Poverty Reduction, Creative Arts, Education, Community Development

## Example prompts

- "Find youth music education charities"
- "Show me surf therapy nonprofits in the UK"
- "What mental health organisations work with young people?"
- "Tell me about Bridges for Music"
- "Which nonprofits work in South Africa?"
- "List all cause areas and how many charities are in each"
- "I want to donate to a youth entrepreneurship charity"

## How it works

GiveReady is an open, verified directory of youth nonprofits. Each organisation is listed with:

- Mission and description
- Programmes with beneficiary counts
- Impact metrics (people served, graduation rates, etc.)
- Cause areas and country
- Direct donation links (Every.org, own website, or USDC on Solana)
- Legal registrations and annual budget data

The MCP server queries the GiveReady API at giveready.org and returns structured data that AI assistants can present to donors.

## About

Built by [TestVentures.net](https://testventures.net) — fractional AI ops for youth nonprofits.

GiveReady is an app by TestVentures.net. Lookup fees fund the [Finn Wardman World Explorer Fund](https://finnwardman.com).

## License

MIT
