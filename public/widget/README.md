# GiveReady Donate Widget

Open-source embeddable USDC donation button for nonprofits using Solana Pay QR codes and direct wallet transfers.

## Features

- **Zero dependencies** — Single 21KB JavaScript file, no frameworks
- **Live API integration** — Fetches nonprofit data and wallet addresses from GiveReady API
- **Solana Pay QR codes** — Dynamic QR generation for any donation amount
- **Mobile optimized** — Deep links to Phantom and Coinbase Wallet
- **No intermediaries** — Direct USDC transfers, 100% goes to nonprofit
- **Production-ready** — Clean, modern UI, fully responsive, error handling

## Installation

Add this HTML to your website:

```html
<div id="giveready-donate" data-slug="your-nonprofit-slug"></div>
<script src="https://giveready.org/widget/donate.js"></script>
```

Replace `your-nonprofit-slug` with your organization's GiveReady slug.

## How It Works

1. **Button** — Visitor clicks "Donate with USDC" button
2. **Modal** — Dialog opens with nonprofit info and donation amounts
3. **QR Code** — Solana Pay QR code generated for selected amount
4. **Wallet** — Scan with Phantom or Coinbase Wallet (desktop or mobile)
5. **Transfer** — Direct USDC transfer to nonprofit's Solana address
6. **Settlement** — Transaction settles on Solana mainnet, no fees

## Widget Attributes

### `data-slug` (required)

The GiveReady slug for your organization. This is used to fetch your nonprofit profile and USDC wallet address from the API.

```html
<div id="giveready-donate" data-slug="finn-wardman-world-explorer-fund"></div>
```

## Preset Amounts

The widget offers preset donation amounts:
- $1
- $5
- $10
- $25
- Custom (user-entered)

## Browser Support

- All modern browsers (ES6+)
- Chrome, Firefox, Safari, Edge
- Mobile browsers (iOS Safari, Chrome Android)

## Technical Details

| Property | Value |
|----------|-------|
| API Base | `https://giveready.geordie-08d.workers.dev/api` |
| QR Code | Generated via QR Server API (no auth required) |
| Network | Solana Mainnet Beta |
| Token | USDC (EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v) |
| Wallets | Phantom, Coinbase Wallet, any Solana Pay compatible |
| CSS Prefix | All classes prefixed with `giveready-` to prevent conflicts |
| Data Fetched | Nonprofit name, mission, USDC wallet address |

## Customization

The widget uses inline CSS scoped with the `giveready-` prefix. You can override styles:

```css
.giveready-btn {
  background: linear-gradient(135deg, #1f2937 0%, #111827 100%) !important;
  /* your overrides */
}
```

## Demo

Open `demo.html` in a browser to see a live example with the Finn Wardman World Explorer Fund.

```bash
open demo.html
```

## How It Fetches Data

When the widget loads, it makes a request to:

```
GET https://giveready.geordie-08d.workers.dev/api/nonprofits/{slug}
```

Response includes:

```json
{
  "id": "...",
  "slug": "finn-wardman-world-explorer-fund",
  "name": "Finn Wardman World Explorer Fund",
  "mission": "...",
  "usdc_wallet": "J4F3RwWiCnAvyeMqnrxMb7RC8CVg2kk8VyPFfzbfn3CH",
  ...
}
```

## Solana Pay Format

The widget generates Solana Pay URLs in this format:

```
solana:{wallet_address}?amount={amount_in_cents}&spl-token={token_address}&label={nonprofit_name}&message=Donation via GiveReady
```

These are converted to QR codes using the QR Server API.

## Mobile Deeplinks

For mobile users without scanning capability, the widget provides direct deeplinks:

**Phantom:**
```
https://phantom.app/ul/browse/transfer?recipient={wallet}&amount={atomic_amount}&spl_token={token}...
```

**Coinbase:**
```
https://go.cb-w.com/send?to={wallet}&amount={atomic_amount}&token={token}...
```

## Error Handling

- If the API is unreachable, the widget displays a simple error message
- If a nonprofit slug doesn't exist, a 404 error is returned
- Network errors are caught and logged to console

## License

MIT. Use, modify, and distribute freely.

## Built By

[TestVentures.net](https://testventures.net) — Fractional AI ops for youth nonprofits.

## For the Gates Foundation

This widget is part of GiveReady's submission to the "AI to Accelerate Charitable Giving" Grand Challenge. It demonstrates:

- **Open-source infrastructure** for nonprofit fundraising
- **Cryptocurrency integration** with Solana Pay
- **Zero-fee donations** (100% reaches the nonprofit)
- **AI-discoverable nonprofits** through the GiveReady API
- **Production-ready code** suitable for 10,000+ nonprofits

The widget is self-contained, dependency-free, and designed for scale. Nonprofits can embed it on their websites with a single line of code.
