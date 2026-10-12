/**
 * GiveReady — Inline get-started page HTML.
 *
 * Split out of src/index.js (refactor, no behaviour change).
 */

// ============================================
// GET STARTED PAGE HTML
// ============================================

const GET_STARTED_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Get Started — GiveReady</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --text: #111; --muted: #666; --light: #999; --border: #e5e5e5;
      --bg: #fff; --surface: #f9fafb;
      --sans: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    }
    html { scroll-behavior: smooth; }
    body { background: var(--bg); color: var(--text); font-family: var(--sans); font-size: 15px; line-height: 1.6; -webkit-font-smoothing: antialiased; }

    /* NAV */
    nav { position: sticky; top: 0; z-index: 100; background: rgba(255,255,255,0.92); backdrop-filter: blur(12px); border-bottom: 1px solid var(--border); height: 48px; padding: 0 24px; display: flex; align-items: center; justify-content: space-between; }
    .nav-left { display: flex; align-items: center; gap: 8px; }
    .nav-name { font-weight: 700; font-size: 14px; color: var(--text); text-decoration: none; letter-spacing: -0.01em; }
    .nav-tag { font-size: 10px; font-weight: 600; color: var(--light); border: 1px solid var(--border); padding: 2px 6px; border-radius: 3px; letter-spacing: 0.02em; }

    /* LAYOUT */
    .wrap { max-width: 680px; margin: 0 auto; padding: 0 24px; }
    .section { padding: 64px 0; border-bottom: 1px solid var(--border); }
    .section:last-of-type { border-bottom: none; }

    /* HERO */
    .hero { padding: 80px 24px 64px; text-align: center; border-bottom: 1px solid var(--border); }
    .hero-inner { max-width: 620px; margin: 0 auto; }
    .hero h1 { font-size: clamp(26px, 5.5vw, 40px); font-weight: 800; line-height: 1.1; letter-spacing: -0.03em; margin-bottom: 16px; }
    .hero p { font-size: clamp(15px, 2.5vw, 17px); color: var(--muted); line-height: 1.6; max-width: 520px; margin: 0 auto; }

    /* CARDS */
    .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 32px; }
    .card { padding: 24px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); }
    .card h3 { font-size: 15px; font-weight: 700; margin-bottom: 8px; letter-spacing: -0.01em; }
    .card p { font-size: 13px; color: var(--muted); line-height: 1.6; }

    /* ZERO FEES */
    .fees-section { text-align: center; }
    .fees-section h2 { font-size: clamp(22px, 4vw, 28px); font-weight: 700; letter-spacing: -0.02em; margin-bottom: 12px; }
    .fees-section p { font-size: 14px; color: var(--muted); line-height: 1.7; max-width: 540px; margin: 0 auto; }

    /* STEPS */
    .steps-section h2 { font-size: clamp(22px, 4vw, 28px); font-weight: 700; letter-spacing: -0.02em; margin-bottom: 24px; }
    .step { display: flex; gap: 16px; padding: 16px 0; border-bottom: 1px solid var(--border); }
    .step:last-child { border-bottom: none; }
    .step-num { font-size: 12px; font-weight: 700; color: var(--light); min-width: 24px; padding-top: 2px; }
    .step-text { font-size: 14px; color: #444; line-height: 1.6; }
    .step-text strong { color: var(--text); font-weight: 600; }

    /* CTA */
    .cta-section { text-align: center; padding: 80px 24px; background: var(--text); color: #fff; }
    .cta-section h2 { font-size: clamp(24px, 5vw, 36px); font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; margin-bottom: 12px; color: #fff; }
    .cta-section p { font-size: 15px; color: rgba(255,255,255,0.5); margin-bottom: 28px; }
    .btn-white { display: inline-block; background: #fff; color: var(--text); font-size: 15px; font-weight: 700; text-decoration: none; padding: 14px 32px; border-radius: 6px; transition: opacity 0.15s; }
    .btn-white:hover { opacity: 0.9; }
    .cta-secondary { display: block; margin-top: 16px; font-size: 13px; color: rgba(255,255,255,0.4); text-decoration: none; }
    .cta-secondary:hover { color: rgba(255,255,255,0.7); }

    /* STORY */
    .story-section { padding: 48px 0; }
    .story-section h3 { font-size: 14px; font-weight: 600; color: var(--muted); margin-bottom: 12px; }
    .story-section p { font-size: 14px; color: var(--muted); line-height: 1.8; max-width: 560px; }

    /* FOOTER */
    footer { padding: 32px 24px; text-align: center; border-top: 1px solid var(--border); }
    .footer-main { font-size: 13px; color: var(--muted); margin-bottom: 8px; }
    .footer-main a { color: var(--muted); text-decoration: none; }
    .footer-main a:hover { color: var(--text); }
    .footer-links { font-size: 12px; color: var(--light); }
    .footer-links a { color: var(--light); text-decoration: none; }
    .footer-links a:hover { color: var(--text); }

    @media (max-width: 640px) { .cards { grid-template-columns: 1fr; } }
    @media (max-width: 480px) { .hero { padding: 48px 24px 40px; } }
  </style>
</head>
<body>

<nav>
  <div class="nav-left">
    <a href="https://giveready.org" class="nav-name">GiveReady</a>
    <span class="nav-tag">get started</span>
  </div>
</nav>

<!-- HERO -->
<div class="hero">
  <div class="hero-inner">
    <h1>Your charity deserves a donation page that actually works.</h1>
    <p>One link. Credit card, Revolut, crypto. Zero platform fees. AI agents can find you. Takes 10 minutes.</p>
  </div>
</div>

<!-- WHAT YOU GET -->
<div class="section">
  <div class="wrap">
    <div class="cards">
      <div class="card">
        <h3>One link for everything</h3>
        <p>Your own page at giveready.org/donate/your-charity. Put it in your Instagram bio, your email signature, on event posters. Donors see your mission, your impact, and can give instantly.</p>
      </div>
      <div class="card">
        <h3>Every payment method</h3>
        <p>Credit card via MoonPay. Banking apps like Revolut and Coinbase. Crypto wallets like Phantom. Your donors choose. You receive USDC directly \\u2014 no intermediary.</p>
      </div>
      <div class="card">
        <h3>AI agents find you</h3>
        <p>When someone asks Claude or ChatGPT \\u201cwhere can I donate to help young people?\\u201d \\u2014 your charity shows up. GiveReady makes your org discoverable by AI assistants. No other platform does this.</p>
      </div>
    </div>
  </div>
</div>

<!-- ZERO FEES -->
<div class="section">
  <div class="wrap fees-section">
    <h2>We don\\u2019t charge platform fees. Ever.</h2>
    <p>Credit card donations have standard processing fees (~4.5% via MoonPay). Banking app and crypto wallet donations are essentially free. Either way, we don\\u2019t take a cut. 100% reaches your charity.</p>
  </div>
</div>

<!-- HOW IT WORKS -->
<div class="section">
  <div class="wrap steps-section">
    <h2>How it works</h2>
    <div class="step">
      <span class="step-num">01</span>
      <div class="step-text"><strong>Tell us about your charity</strong> \\u2014 name, mission, registration number.</div>
    </div>
    <div class="step">
      <span class="step-num">02</span>
      <div class="step-text"><strong>We verify you</strong> against your national charity registry.</div>
    </div>
    <div class="step">
      <span class="step-num">03</span>
      <div class="step-text"><strong>You get your page</strong> at giveready.org/donate/your-slug \\u2014 live in minutes.</div>
    </div>
    <div class="step">
      <span class="step-num">04</span>
      <div class="step-text"><strong>Put the link in your bio.</strong> Done.</div>
    </div>
  </div>
</div>

<!-- CTA -->
<div class="cta-section">
  <h2>Get your free donation page</h2>
  <p>10 minutes. Zero cost. Start receiving donations today.</p>
  <a href="/onboard" class="btn-white">Get your free page \\u2192</a>
  <a href="/donate/finn-wardman-world-explorer-fund" class="cta-secondary">See it in action \\u2192</a>
</div>

<!-- STORY -->
<div class="section">
  <div class="wrap story-section">
    <h3>Why is this free?</h3>
    <p>GiveReady was built by Geordie Wardman after his son Finn died in 2023 at age 20. Finn was a freeride skier, a surfer, and the kind of person who said yes before he\\u2019d figured out the logistics. The Finn Wardman World Explorer Fund was created in his memory. GiveReady exists to make sure small charities like Finn\\u2019s fund can be found by anyone, anywhere \\u2014 including AI agents. It\\u2019s free because charging fees on charitable donations defeats the purpose.</p>
  </div>
</div>

<footer>
  <div class="footer-main">GiveReady is open-source, free, and built in memory of <a href="https://www.finnwardman.com">Finn Wardman</a>.</div>
  <div class="footer-links">Built by <a href="https://testventures.net">TestVentures.net</a> &middot; <a href="https://docs.giveready.org/introduction">About</a> &middot; <a href="/privacy">Privacy</a> &middot; <a href="mailto:geordie@testventures.net">Contact</a></div>
</footer>

</body>
</html>`;
