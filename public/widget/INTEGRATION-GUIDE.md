# GiveReady Widget Integration Guide

A step-by-step guide for nonprofits to add the USDC donation button to their website.

## Before You Start

You'll need:
1. Your nonprofit's slug (e.g., `finn-wardman-world-explorer-fund`)
2. A Solana wallet address for receiving donations
3. Your organization registered in the GiveReady database

If you don't have a slug or wallet set up, visit [giveready.org](https://giveready.org) or email [hello@giveready.org](mailto:hello@giveready.org).

## Step 1: Find Your Slug

Your GiveReady slug is the unique identifier for your nonprofit. It's the URL-friendly version of your name.

Examples:
- `finn-wardman-world-explorer-fund`
- `bridges-for-music`
- `the-wave-project`

If you're not sure what your slug is, check your GiveReady profile or contact the GiveReady team.

## Step 2: Copy the Embed Code

Copy this code snippet:

```html
<div id="giveready-donate" data-slug="YOUR-SLUG-HERE"></div>
<script src="https://giveready.org/widget/donate.js"></script>
```

Replace `YOUR-SLUG-HERE` with your organization's actual slug.

## Step 3: Paste Into Your Website

### HTML/Static Sites

Paste the code into any `.html` file where you want the button to appear:

```html
<!DOCTYPE html>
<html>
<body>

  <h1>Donate to Our Cause</h1>
  <p>Support our mission by donating USDC on Solana.</p>

  <!-- Paste the widget code here -->
  <div id="giveready-donate" data-slug="finn-wardman-world-explorer-fund"></div>
  <script src="https://giveready.org/widget/donate.js"></script>

</body>
</html>
```

### WordPress

1. Log in to WordPress admin
2. Go to Pages or Posts
3. Edit the page where you want the button
4. Switch to "HTML" or "Code" editor (depending on your theme)
5. Paste the widget code
6. Save and publish

### Webflow

1. Go to the page where you want the button
2. Add a custom HTML embed element
3. Paste the widget code into the embed
4. Publish

### Squarespace

1. Edit the page
2. Click "+" to add a block
3. Search for "Code Block" or "Custom Code"
4. Paste the widget code
5. Save and publish

### Wix

1. Edit the page
2. Click "+" to add an element
3. Search for "Embed" or "HTML"
4. Paste the widget code
5. Publish

### Other Platforms

Most website builders have a way to embed custom HTML or "custom code". Look for:
- Custom HTML embed
- Code block
- HTML widget
- Custom component

If you're unsure how to embed code on your platform, search "[your platform] custom HTML embed" or contact your website host's support.

## Step 4: Set Up Your Solana Wallet

If you haven't already, create a Solana wallet that will receive donations:

### Option A: Use Phantom Wallet (Recommended)

1. Visit [phantom.app](https://phantom.app)
2. Install the browser extension or mobile app
3. Create a new wallet or import an existing one
4. Copy your Solana address (it looks like `J4F3RwWiCnAvyeMqnrxMb7RC8CVg2kk8VyPFfzbfn3CH`)
5. Share your address with GiveReady so it's added to your profile

### Option B: Use Coinbase Wallet

1. Visit [coinbase.com/wallet](https://coinbase.com/wallet)
2. Create or import a wallet
3. Make sure you have a Solana address
4. Copy your address and share with GiveReady

### Option C: Use Solflare

1. Visit [solflare.com](https://solflare.com)
2. Create or import a wallet
3. Copy your Solana address
4. Share with GiveReady

## Step 5: Test the Widget

1. Visit your website in a browser
2. Look for the "Donate with USDC" button
3. Click it to open the donation modal
4. Select an amount ($1, $5, $10, $25, or custom)
5. Scan the QR code with your Phantom or Coinbase Wallet
6. Sign the transaction

Test with a small amount first ($1) to make sure everything works.

## Common Issues

### Button Doesn't Appear

- Check that you copied the code exactly (including the `data-slug` attribute)
- Make sure the slug matches your organization's GiveReady profile
- Open your browser's developer console (F12) and look for errors
- Check that the page has network access to `giveready.geordie-08d.workers.dev`

### QR Code Doesn't Load

- Make sure you have a stable internet connection
- The QR code uses the QR Server API — if that service is down, QR codes won't generate
- Try clicking "Phantom Wallet" or "Coinbase Wallet" instead of scanning

### Wallet Address Isn't Recognized

- Make sure your wallet address is on the Solana mainnet
- Double-check that it's a Solana address, not Ethereum or another blockchain
- Make sure your wallet has been registered with GiveReady

### Donation Doesn't Show Up

- Check your wallet (Phantom, Coinbase, etc.) to confirm the transaction was signed
- Look at your Solana wallet on [solscan.io](https://solscan.io) — paste your wallet address to see all transactions
- USDC donations may take a few seconds to appear in your wallet
- If the transaction failed, you can try again

## Customizing the Button

The widget uses a dark button with a subtle gradient. If you want to customize it, you can add CSS to your page:

```html
<style>
  .giveready-btn {
    background: linear-gradient(135deg, #1f2937 0%, #111827 100%) !important;
    padding: 12px 24px !important;
    border-radius: 8px !important;
    font-size: 15px !important;
  }
</style>

<div id="giveready-donate" data-slug="your-slug"></div>
<script src="https://giveready.org/widget/donate.js"></script>
```

Available CSS classes to customize:
- `.giveready-btn` — The donation button
- `.giveready-modal` — The modal dialog
- `.giveready-modal-header` — Modal header
- `.giveready-modal-body` — Modal body
- `.giveready-amount-btn` — Amount buttons
- `.giveready-qr-section` — QR code section
- `.giveready-mobile-link` — Wallet deep-link buttons

All classes are prefixed with `giveready-` to avoid conflicts with your site's CSS.

## Support

If you run into issues, reach out:

- **Email:** [hello@giveready.org](mailto:hello@giveready.org)
- **Documentation:** [giveready.org/docs](https://giveready.org/docs)
- **GitHub Issues:** [github.com/giveready/widget/issues](https://github.com/giveready/widget/issues)

## Monitoring Donations

After you set up the widget, you can monitor donations:

1. **On Solscan:** Visit [solscan.io](https://solscan.io) and paste your wallet address to see all incoming USDC transfers
2. **In Your Wallet:** Phantom, Coinbase, and Solflare all show transaction history
3. **Via GiveReady API:** [giveready.org/api/donations/{slug}](https://giveready.org/api/donations/your-slug) returns all donations to your organization

## What Happens With Donations

- **100% goes to you** — GiveReady takes no platform fees
- **Direct transfers** — Donations go directly to your wallet on the Solana blockchain
- **No intermediaries** — No bank, no payment processor, no middleman
- **Instant settlement** — Donations settle in 2-3 seconds on Solana
- **USDC only** — All donations are in USDC (a stablecoin pegged to the US dollar)

## Next Steps

1. Add the widget to your website
2. Test with a $1 donation
3. Share the donation link with your supporters
4. Monitor donations via Solscan or your wallet

Welcome to GiveReady. Let's make direct fundraising frictionless.
