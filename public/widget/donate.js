/**
 * GiveReady Donate Button Widget
 * Open-source embeddable donate widget for nonprofits
 *
 * Usage:
 *   <div id="giveready-donate" data-slug="nonprofit-slug"></div>
 *   <script src="https://giveready.org/widget/donate.js"></script>
 *
 * Features:
 * - Zero dependencies, self-contained
 * - Fetches nonprofit data from GiveReady API
 * - Generates Solana Pay QR codes
 * - Mobile-friendly modal UI
 * - Direct wallet links for Phantom and Coinbase Wallet
 */

(function() {
  'use strict';

  // Configuration
  const CONFIG = {
    apiBase: 'https://giveready.org/api',
    qrApiBase: 'https://api.qrserver.com/v1/create-qr-code',
    widgetId: 'giveready-donate',
    amounts: [1, 5, 10, 25],
    splToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC on Solana
  };

  // ============================================
  // STYLES - Injected into document
  // ============================================

  const STYLES = `
    #giveready-donate-button {
      display: inline-block;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }

    .giveready-btn {
      background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
      color: #ffffff;
      border: none;
      border-radius: 8px;
      padding: 12px 24px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    }

    .giveready-btn:hover {
      background: linear-gradient(135deg, #374151 0%, #1f2937 100%);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      transform: translateY(-1px);
    }

    .giveready-btn:active {
      transform: translateY(0);
    }

    .giveready-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Modal Overlay */
    .giveready-modal-overlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }

    .giveready-modal-overlay.active {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .giveready-modal {
      background: #ffffff;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      max-width: 420px;
      width: 90%;
      max-height: 90vh;
      overflow-y: auto;
      position: relative;
    }

    /* Modal Header */
    .giveready-modal-header {
      border-bottom: 1px solid #e5e7eb;
      padding: 24px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }

    .giveready-modal-close {
      background: none;
      border: none;
      font-size: 24px;
      cursor: pointer;
      color: #6b7280;
      padding: 0;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: all 0.2s ease;
    }

    .giveready-modal-close:hover {
      background: #f3f4f6;
      color: #1f2937;
    }

    .giveready-header-text h3 {
      margin: 0 0 4px 0;
      font-size: 18px;
      font-weight: 700;
      color: #1f2937;
    }

    .giveready-header-text p {
      margin: 0;
      font-size: 13px;
      color: #6b7280;
    }

    /* Modal Body */
    .giveready-modal-body {
      padding: 24px;
    }

    .giveready-nonprofit-info {
      margin-bottom: 24px;
      padding: 16px;
      background: #f9fafb;
      border-radius: 8px;
      border-left: 4px solid #1f2937;
    }

    .giveready-nonprofit-info h4 {
      margin: 0 0 8px 0;
      font-size: 15px;
      font-weight: 600;
      color: #1f2937;
    }

    .giveready-nonprofit-info p {
      margin: 0;
      font-size: 13px;
      line-height: 1.5;
      color: #4b5563;
    }

    /* Amount Selector */
    .giveready-amounts {
      margin-bottom: 24px;
    }

    .giveready-amounts-label {
      font-size: 13px;
      font-weight: 600;
      color: #374151;
      margin-bottom: 12px;
      display: block;
    }

    .giveready-amounts-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr 1fr;
      gap: 8px;
      margin-bottom: 12px;
    }

    .giveready-amount-btn {
      padding: 12px 8px;
      border: 2px solid #e5e7eb;
      background: #ffffff;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      color: #1f2937;
    }

    .giveready-amount-btn:hover {
      border-color: #1f2937;
      background: #f9fafb;
    }

    .giveready-amount-btn.active {
      background: #1f2937;
      color: #ffffff;
      border-color: #1f2937;
    }

    .giveready-custom-amount {
      display: flex;
      gap: 8px;
    }

    .giveready-custom-amount input {
      flex: 1;
      padding: 10px 12px;
      border: 2px solid #e5e7eb;
      border-radius: 6px;
      font-size: 13px;
      font-family: inherit;
      transition: border-color 0.2s ease;
    }

    .giveready-custom-amount input:focus {
      outline: none;
      border-color: #1f2937;
      background: #ffffff;
    }

    .giveready-custom-amount-btn {
      padding: 10px 16px;
      background: #f3f4f6;
      border: 2px solid #e5e7eb;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      color: #1f2937;
    }

    .giveready-custom-amount-btn:hover {
      background: #e5e7eb;
    }

    .giveready-custom-amount-btn.active {
      background: #1f2937;
      color: #ffffff;
      border-color: #1f2937;
    }

    /* QR Code Section */
    .giveready-qr-section {
      text-align: center;
      margin-bottom: 24px;
      padding: 20px;
      background: #f9fafb;
      border-radius: 8px;
    }

    .giveready-qr-label {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #6b7280;
      margin-bottom: 12px;
    }

    .giveready-qr-code {
      display: inline-block;
      padding: 12px;
      background: #ffffff;
      border-radius: 6px;
      border: 1px solid #e5e7eb;
    }

    .giveready-qr-code img {
      display: block;
      border-radius: 4px;
      image-rendering: pixelated;
    }

    .giveready-qr-instructions {
      font-size: 12px;
      color: #6b7280;
      margin-top: 12px;
      line-height: 1.4;
    }

    /* Mobile Links */
    .giveready-mobile-links {
      margin-bottom: 20px;
    }

    .giveready-mobile-link {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px;
      margin-bottom: 8px;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      text-decoration: none;
      color: #1f2937;
      transition: all 0.2s ease;
      font-size: 13px;
      font-weight: 500;
    }

    .giveready-mobile-link:hover {
      background: #f3f4f6;
      border-color: #d1d5db;
    }

    .giveready-mobile-link-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .giveready-mobile-link-label {
      font-size: 11px;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    /* Wallet Address */
    .giveready-wallet-section {
      padding: 12px;
      background: #f3f4f6;
      border-radius: 6px;
      margin-bottom: 16px;
    }

    .giveready-wallet-label {
      font-size: 11px;
      font-weight: 600;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      margin-bottom: 6px;
    }

    .giveready-wallet-address {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      font-family: "Monaco", "Courier New", monospace;
      font-size: 11px;
      color: #1f2937;
      word-break: break-all;
      line-height: 1.3;
    }

    .giveready-wallet-copy {
      background: none;
      border: none;
      cursor: pointer;
      color: #6b7280;
      padding: 0;
      flex-shrink: 0;
      font-size: 14px;
      transition: color 0.2s ease;
    }

    .giveready-wallet-copy:hover {
      color: #1f2937;
    }

    .giveready-wallet-copy.copied {
      color: #10b981;
    }

    /* Footer */
    .giveready-modal-footer {
      border-top: 1px solid #e5e7eb;
      padding: 16px 24px;
      text-align: center;
      font-size: 11px;
      color: #9ca3af;
    }

    .giveready-powered-by {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
    }

    .giveready-powered-by a {
      color: #6b7280;
      text-decoration: none;
      transition: color 0.2s ease;
    }

    .giveready-powered-by a:hover {
      color: #1f2937;
      text-decoration: underline;
    }

    /* Loading State */
    .giveready-loading {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid #e5e7eb;
      border-top: 2px solid #1f2937;
      border-radius: 50%;
      animation: giveready-spin 0.8s linear infinite;
    }

    @keyframes giveready-spin {
      to { transform: rotate(360deg); }
    }

    /* Error State */
    .giveready-error {
      padding: 12px;
      background: #fee2e2;
      border: 1px solid #fecaca;
      border-radius: 6px;
      color: #991b1b;
      font-size: 13px;
      margin-bottom: 16px;
    }

    /* Responsive */
    @media (max-width: 480px) {
      .giveready-modal {
        width: 95%;
        max-height: 85vh;
        border-radius: 12px;
      }

      .giveready-amounts-grid {
        grid-template-columns: 1fr 1fr;
      }

      .giveready-modal-body {
        padding: 16px;
      }

      .giveready-modal-header {
        padding: 16px;
      }

      .giveready-modal-footer {
        padding: 12px 16px;
      }
    }
  `;

  // ============================================
  // UTILITY FUNCTIONS
  // ============================================

  function injectStyles() {
    const styleElement = document.createElement('style');
    styleElement.textContent = STYLES;
    styleElement.id = 'giveready-widget-styles';
    document.head.appendChild(styleElement);
  }

  function generateQRCodeUrl(solanaPayUrl) {
    // Use QR code API with URL encoding
    const encodedUrl = encodeURIComponent(solanaPayUrl);
    return `${CONFIG.qrApiBase}/?size=200x200&data=${encodedUrl}`;
  }

  function buildSolanaPayUrl(walletAddress, amount, nonprofitName, currency = 'USDC') {
    const params = new URLSearchParams({
      amount: amount.toString(),
      label: nonprofitName,
      message: 'Donation via GiveReady',
    });
    if (currency === 'USDC') {
      params.set('spl-token', CONFIG.splToken);
    }
    return `solana:${walletAddress}?${params.toString()}`;
  }

  function formatWalletAddress(address) {
    if (!address || address.length < 10) return address;
    return `${address.substring(0, 6)}...${address.substring(address.length - 6)}`;
  }

  function copyToClipboard(text, button) {
    navigator.clipboard.writeText(text).then(() => {
      const originalText = button.textContent;
      button.textContent = '✓ Copied';
      button.classList.add('copied');
      setTimeout(() => {
        button.textContent = originalText;
        button.classList.remove('copied');
      }, 2000);
    }).catch(() => {
      button.textContent = 'Copy failed';
      setTimeout(() => {
        button.textContent = originalText;
      }, 2000);
    });
  }

  // ============================================
  // WIDGET CLASS
  // ============================================

  class GiveReadyWidget {
    constructor(container, slug) {
      this.container = container;
      this.slug = slug;
      this.nonprofit = null;
      this.selectedAmount = null;
      this.customAmount = null;
      this.currency = 'USDC'; // 'USDC' or 'SOL'
      this.modal = null;
    }

    async init() {
      try {
        // Create button
        this.createButton();

        // Fetch nonprofit data
        await this.fetchNonprofitData();

        // Attach event listeners
        this.attachEventListeners();
      } catch (error) {
        console.error('GiveReady widget error:', error);
        this.container.innerHTML = '<p style="color: #ef4444; font-size: 13px;">Failed to load donation widget</p>';
      }
    }

    createButton() {
      const buttonWrapper = document.createElement('div');
      buttonWrapper.id = 'giveready-donate-button';

      const button = document.createElement('button');
      button.className = 'giveready-btn';
      button.textContent = 'Donate with USDC';
      button.id = 'giveready-donate-btn';

      buttonWrapper.appendChild(button);
      this.container.appendChild(buttonWrapper);

      // Create modal
      this.createModal();
    }

    createModal() {
      const overlay = document.createElement('div');
      overlay.className = 'giveready-modal-overlay';
      overlay.id = 'giveready-modal-overlay';

      const modal = document.createElement('div');
      modal.className = 'giveready-modal';
      modal.id = 'giveready-modal';

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      this.modal = modal;
      this.modalOverlay = overlay;
    }

    async fetchNonprofitData() {
      const response = await fetch(`${CONFIG.apiBase}/nonprofits/${this.slug}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch nonprofit data: ${response.statusText}`);
      }
      this.nonprofit = await response.json();
    }

    renderModal() {
      if (!this.nonprofit) return;

      const { name, mission, usdc_wallet } = this.nonprofit;

      let modalHTML = `
        <div class="giveready-modal-header">
          <div class="giveready-header-text">
            <h3>${this.escapeHtml(name)}</h3>
            <p>Donate USDC on Solana</p>
          </div>
          <button class="giveready-modal-close" id="giveready-modal-close">×</button>
        </div>

        <div class="giveready-modal-body">
          <div class="giveready-nonprofit-info">
            <h4>About</h4>
            <p>${this.escapeHtml(mission || 'Making a difference.')}</p>
          </div>

          <div class="giveready-currency-toggle" style="display:flex;gap:8px;margin-bottom:16px;">
            <button class="giveready-amount-btn ${this.currency === 'USDC' ? 'active' : ''}" data-currency="USDC" style="flex:1;font-size:13px;">USDC</button>
            <button class="giveready-amount-btn ${this.currency === 'SOL' ? 'active' : ''}" data-currency="SOL" style="flex:1;font-size:13px;">SOL</button>
          </div>

          <div class="giveready-amounts">
            <label class="giveready-amounts-label">Select Amount (${this.currency === 'USDC' ? 'USD' : 'SOL'})</label>
            <div class="giveready-amounts-grid">
              ${(this.currency === 'SOL' ? [0.01, 0.05, 0.1, 0.5] : CONFIG.amounts).map(amt => `
                <button class="giveready-amount-btn" data-amount="${amt}">${this.currency === 'USDC' ? '$' : '◎'}${amt}</button>
              `).join('')}
            </div>
            <div class="giveready-custom-amount">
              <input type="number" id="giveready-custom-input" placeholder="Custom" min="0" step="0.01" />
              <button class="giveready-custom-amount-btn" id="giveready-custom-btn">Set</button>
            </div>
          </div>
      `;

      if (this.selectedAmount || this.customAmount) {
        const amount = this.customAmount || this.selectedAmount;
        const solanaPayUrl = buildSolanaPayUrl(usdc_wallet, amount, name, this.currency);
        const qrCodeUrl = generateQRCodeUrl(solanaPayUrl);
        const amountLabel = this.currency === 'USDC' ? `$${amount}` : `◎${amount} SOL`;

        modalHTML += `
          <div class="giveready-qr-section">
            <div class="giveready-qr-label">Scan to Donate ${amountLabel}</div>
            <div class="giveready-qr-code">
              <img src="${qrCodeUrl}" alt="Solana Pay QR Code" width="200" height="200" />
            </div>
            <div class="giveready-qr-instructions">
              Scan with Phantom or Coinbase Wallet
            </div>
          </div>

          <div class="giveready-mobile-links">
            <a href="${this.buildPhantomLink(usdc_wallet, amount, name)}" class="giveready-mobile-link">
              <div class="giveready-mobile-link-text">
                <span>Open in Wallet</span>
                <span class="giveready-mobile-link-label">Transfer ${amountLabel} via Solana Pay</span>
              </div>
              <span>→</span>
            </a>
          </div>
        `;
      }

      modalHTML += `
        <div class="giveready-wallet-section">
          <div class="giveready-wallet-label">Nonprofit Wallet</div>
          <div class="giveready-wallet-address">
            <span>${this.escapeHtml(usdc_wallet)}</span>
            <button class="giveready-wallet-copy" id="giveready-wallet-copy">📋</button>
          </div>
        </div>

        <div class="giveready-modal-footer">
          <div class="giveready-powered-by">
            <span>Powered by</span>
            <a href="https://giveready.org" target="_blank" rel="noopener">GiveReady</a>
          </div>
        </div>
        </div>
      `;

      this.modal.innerHTML = modalHTML;
      this.attachModalListeners();
    }

    buildPhantomLink(wallet, amount, name) {
      // Use the solana: protocol directly — Phantom registers as a handler on mobile
      return buildSolanaPayUrl(wallet, amount, name, this.currency);
    }

    buildCoinbaseLink(wallet, amount, name) {
      // Use the solana: protocol directly — Coinbase Wallet registers as a handler on mobile
      return buildSolanaPayUrl(wallet, amount, name, this.currency);
    }

    attachEventListeners() {
      const button = document.getElementById('giveready-donate-btn');
      const overlay = this.modalOverlay;

      button.addEventListener('click', () => {
        this.renderModal();
        overlay.classList.add('active');
      });

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.classList.remove('active');
        }
      });
    }

    attachModalListeners() {
      const closeBtn = document.getElementById('giveready-modal-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          this.modalOverlay.classList.remove('active');
        });
      }

      // Currency toggle
      document.querySelectorAll('[data-currency]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          this.currency = btn.dataset.currency;
          this.selectedAmount = null;
          this.customAmount = null;
          this.renderModal();
        });
      });

      // Amount buttons
      document.querySelectorAll('.giveready-amount-btn:not([data-currency])').forEach(btn => {
        btn.addEventListener('click', (e) => {
          document.querySelectorAll('.giveready-amount-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.selectedAmount = parseFloat(btn.dataset.amount);
          this.customAmount = null;
          this.renderModal();
        });
      });

      // Custom amount
      const customInput = document.getElementById('giveready-custom-input');
      const customBtn = document.getElementById('giveready-custom-btn');

      if (customBtn && customInput) {
        customBtn.addEventListener('click', () => {
          const value = parseFloat(customInput.value);
          if (value > 0) {
            document.querySelectorAll('.giveready-amount-btn').forEach(b => b.classList.remove('active'));
            customBtn.classList.add('active');
            this.customAmount = value;
            this.selectedAmount = null;
            this.renderModal();
          }
        });

        customInput.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            customBtn.click();
          }
        });
      }

      // Wallet copy
      const walletCopy = document.getElementById('giveready-wallet-copy');
      if (walletCopy) {
        walletCopy.addEventListener('click', () => {
          copyToClipboard(this.nonprofit.usdc_wallet, walletCopy);
        });
      }
    }

    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  function initWidgets() {
    // Inject styles once
    if (!document.getElementById('giveready-widget-styles')) {
      injectStyles();
    }

    // Find all donate containers
    const containers = document.querySelectorAll(`[id="${CONFIG.widgetId}"]`);

    containers.forEach(container => {
      const slug = container.dataset.slug;
      if (!slug) {
        console.warn('GiveReady widget missing data-slug attribute');
        return;
      }

      const widget = new GiveReadyWidget(container, slug);
      widget.init();
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWidgets);
  } else {
    initWidgets();
  }
})();
