# ServicePulse Monetization

This document explains how ServicePulse earns money — legally, transparently, and
without hurting the free product.

## Model: Open-Core + Support Licenses + Sponsors

ServicePulse stays **MIT-licensed and fully usable for free**. Money comes from
three sources:

| Source | What the buyer gets | Price |
|---|---|---|
| **ServicePulse Pro** license | 10x longer history (600 points ≈ 30 min), CSV export, priority feature requests, direct email support | one-time, you set it (e.g. $9–19) |
| **GitHub Sponsors** | pure support — funds continued development | any amount, monthly or one-time |
| **Future: managed backend** (optional, later) | hosted telemetry dashboard instead of self-hosting the Node backend | subscription |

Why this model is legal and low-risk:

- **No payment code ships in the app.** The app only verifies a cryptographic
  license key offline. No card data, no payment SDKs, no PCI burden.
- **It is a support license, not DRM.** The source is open (MIT); Pro is an
  honesty-based upgrade that pays for support and extras. This avoids
  consumer-protection issues around "buying features" in closed binaries.
- **Merchant of record handles VAT/tax.** Sell keys through a merchant that acts
  as merchant of record (Lemon Squeezy or Gumroad). They collect and remit EU VAT
  and other sales tax; you receive a payout. If you sell directly via Stripe you
  become the merchant and must handle VAT yourself — do not start there.
- **Income tax is yours to report.** Payouts are taxable income in your country.
  Keep records of payouts (GitHub Sponsors and the merchant both provide
  monthly statements).

## How Pro works technically

1. `licensing/keygen.js` holds the signing scheme: ECDSA P-256 keys.
   - `licensing/private_key.pem` — the private key. **Never commit it, never
     ship it.** It is in `.gitignore`. If it leaks, rotate the keypair and
     update `LICENSE_PUBKEY` in `app/app.js`.
   - `licensing/public-jwk.json` — the public key, embedded in the app.
2. Issue a key after a purchase:

   ```bash
   node licensing/keygen.js init          # only once, to create the keypair
   node licensing/keygen.js issue \
     --name "Customer Name" \
     --email "customer@example.com" \
     --tier pro --expires lifetime        # or YYYY-MM-DD
   node licensing/keygen.js verify "<key>"
   ```

3. The customer pastes the key in the app: **Pro** button → paste → Activate.
   The app verifies the signature offline with WebCrypto (works on Windows and
   Android, no server needed) and stores it locally (Electron: user data file;
   Android: Capacitor Preferences).
4. Verified Pro unlocks: history cap 60 → 600 samples, CSV export button.

Keys are tamper-proof: modifying one character breaks the signature. Keys can
expire (`--expires 2027-11-15`) or be lifetime.

## Where to sell

Set up in this order (all need your identity/bank details — I cannot create
these for you):

1. **GitHub Sponsors** — https://github.com/sponsors. One-time and monthly
   tiers. The `FUNDING.yml` in this repo already points the Sponsor button to
   your account. Payouts via Stripe (they handle tax forms).
2. **Lemon Squeezy or Gumroad** — create one "ServicePulse Pro License"
   product. After each sale, issue a license key with `keygen.js` and email it
   to the buyer (both platforms can automate delivery with a license-key list
   you pre-generate).
3. Optional later: hosted backend subscription once there is real demand.

## Guardrails (do not skip)

- Keep the free tier genuinely useful — crippled free products generate
  chargebacks and bad reviews, not revenue.
- Never commit `private_key.pem`. Rotate immediately if exposed.
- Refund policy: offer a no-questions 14-day refund (merchants make this easy);
  it drastically reduces disputes.
- If revenue grows, track it as self-employment/business income per your
  country's rules.

## Current status (Nov 15, 2026)

- [x] License keygen + verification toolkit (`licensing/`)
- [x] Pro UI in app (badge, modal, activation, CSV export, 600-point history)
- [x] Electron persistence + Android (Capacitor Preferences) persistence
- [x] `FUNDING.yml` → GitHub Sponsors button live on the repo
- [ ] You: create GitHub Sponsors profile
- [ ] You: create Lemon Squeezy/Gumroad account, list the Pro product
- [ ] You: generate + upload a batch of license keys for automated delivery
