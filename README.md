<div align="center">

# TRESSE

**Full-stack e-commerce platform** for handmade knitwear — React frontend + Django REST API backend, deployed live, and tested at every layer.

[![Live Site](https://img.shields.io/badge/live%20site-tressehandmade.com-black?style=flat-square)](https://tressehandmade.com/)
[![CI](https://img.shields.io/github/actions/workflow/status/kseniiaross/tresse-ecommerce/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/kseniiaross/tresse-ecommerce/actions)
![Tests](https://img.shields.io/badge/tests-455%20passing-brightgreen?style=flat-square)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)

[Live Demo](https://tressehandmade.com/) · [Backend](./tresse_backend) · [Frontend](./tresse_frontend)

</div>

---

## Overview

![Home page](tresse_frontend/docs/screenshots/home.png)

TRESSE is a full-stack e-commerce site selling handmade knitwear, built with a **Django REST API** and a **React/TypeScript SPA**. It handles real money — live Stripe payments, automatic US sales tax, refunds — and every one of those paths is covered by an automated test suite, not just eyeballed in the browser.

This isn't a tutorial clone. It's a real, deployed store with the messiness that comes with that: made-to-order garments with custom measurements, guest carts that merge into an account on login, back-in-stock notifications, self-serve returns within a policy window, cookie consent that actually gates the marketing pixels, and a checkout flow that has to stay correct when two people pay for the last piece at the same time.

> **[tressehandmade.com](https://tressehandmade.com/)**

---

## Tech Stack

<table>
<tr>
<td valign="top" width="50%">

### Backend
- **Django 6** + **Django REST Framework**
- **PostgreSQL**
- **Stripe** — hosted Checkout, webhooks, refunds, Stripe Tax
- **SimpleJWT** — token auth with rotation & blacklist
- **django-two-factor-auth** — 2FA on the Django admin
- **django-filter** — catalog filtering
- **Cloudinary** — media storage
- **Sentry** — error monitoring and alerting
- **Anymail / Resend** — transactional email

</td>
<td valign="top" width="50%">

### Frontend
- **React 19** + **TypeScript**
- **Redux Toolkit** — cart, auth, wishlist state
- **React Router 7**
- **React Hook Form** + **Yup** — form validation
- **Axios** — with a refresh-token interceptor
- **Vite**

</td>
</tr>
<tr>
<td valign="top">

### Quality & Tooling (Backend)
- **Ruff** — lint + format
- **pytest** + **pytest-django**
- **PostgreSQL** in CI (GitHub Actions service container)

</td>
<td valign="top">

### Quality & Tooling (Frontend)
- **Biome** — lint + format, including a11y rules
- **TypeScript** — `tsc --noEmit` type checking
- **Vitest** + **Testing Library** — unit/integration tests
- **Playwright** — randomized stress ("monkey") testing

</td>
</tr>
</table>

**CI/CD:** GitHub Actions runs both suites on every push — Django system check, Ruff lint and format check, and pytest against a real PostgreSQL service container for the backend; Biome, Vitest and a production build for the frontend. Deploys are automatic: Railway for the API (migrations run on every deploy), Vercel for the SPA.

---

## Key Features

**Storefront**

![Catalog page](tresse_frontend/docs/screenshots/catalog.png)

- Full product catalog with filtering, search, and sort
- Size and color variant selection
- Custom-length option with a server-side surcharge, snapshotted from the product at the moment the item enters the cart
- Custom-measurement capture for made-to-order pieces, with an explicit final-sale acknowledgement recorded on the order
- Wishlist with back-in-stock email notifications

**Cart & Checkout**

![Checkout page](tresse_frontend/docs/screenshots/checkout.png)

- Guest cart (localStorage) that merges into the account cart on login, line by line — a line that transfers successfully is removed immediately, so a partial failure can't double the quantity on the next attempt
- All pricing is computed server-side from the database; the client never sends a price
- A cart signature is recorded in the Checkout session metadata and re-verified in the webhook, so an order is only created if the cart is identical to what the customer paid for
- Hosted Stripe Checkout with webhook-driven order creation, idempotent against Stripe's at-least-once delivery
- `SELECT FOR UPDATE` row locking on stock, and — if the last piece sells twice — an automatic full refund with an idempotency key, a plain-text apology email to the customer, and an alert to support and Sentry
- Stripe Tax for automatic US sales tax, with nexus monitoring across states
- Shipping currently restricted to the United States at the Checkout session level, with free standard delivery

**Account & Orders**

- JWT authentication with refresh-token rotation and blacklisting
- Rate-limited login, registration, password reset, restore and newsletter endpoints
- Soft-delete account flow with a time-boxed, signed restore link — password reset cannot be used to bypass the window
- Order history with self-serve cancellation (24 hours from purchase) and returns (14 days from delivery, matching the published policy and the API)
- Tracking number and shipped date on each order, with shipping and delivery emails sent from admin actions
- Two-factor authentication on the Django admin

**Privacy & compliance**

- Cookie consent that actually gates behaviour: the Meta and TikTok pixels are injected only after marketing consent is granted, and revoked through the vendor APIs if it is withdrawn
- One-click newsletter unsubscribe through a signed token, linked from every welcome email

**Accessibility**
- Full keyboard navigation across dialogs, dropdowns, and menus
- Managed focus for every modal — moved in on open, trapped with Tab/Shift+Tab, restored on close — from a single shared hook
- Semantic HTML and ARIA enforced via linting, not spot-checked

---

## Testing

Testing here isn't a checkbox — it's how several real bugs in this codebase were found. For the money-moving paths, tests were required to fail against the old code before a fix was accepted.

| Layer | Tool | Coverage | Status |
|---|---|---|---|
| **Backend** | pytest | 191 tests — auth & account lifecycle, orders, Stripe checkout/webhook/refunds, cart & inventory, catalog, newsletter, email templates | ✅ passing |
| **Frontend (unit/integration)** | Vitest + Testing Library | 264 tests — Redux slices, API error handling, hooks, every major page and form | ✅ passing |
| **Frontend (stress test)** | Playwright | 150 seeded randomized actions — clicks, garbage input, navigation, modal toggling | ⚠️ see note below |
| **Type checking** | `tsc --noEmit` | Whole frontend | ✅ 0 errors |
| **Lint / format** | Ruff · Biome (incl. a11y) | Whole backend and frontend | ✅ 0 errors |

### What's actually exercised

- **The money path, end to end:** add to cart → Stripe Checkout session → webhook → order creation, including duplicate-webhook idempotency, missing-metadata and signature-mismatch branches, and the out-of-stock branch that refunds the customer automatically.
- **Cancellations and refunds:** inside and outside the 24-hour window, concurrent cancel attempts, Stripe failures, and a failure *after* Stripe has already refunded — asserting the order is left in a state that makes the orphaned refund discoverable rather than invisible.
- **Returns:** final-sale and custom-size items refused, undelivered orders refused, the window counted from delivery, and each admin action verified to change only qualifying orders.
- **Auth, the whole lifecycle:** registration, login, password reset and change, soft-delete, and time-boxed restore — including that a deactivated account cannot be resurrected through password reset.
- **Cart correctness in both modes:** guest (localStorage) and authenticated (server), including per-line merge-on-login and lines that differ only by custom measurements.
- **Consent gating:** the tracking helpers no-op without consent, each vendor script is injected at most once with it, and consent withdrawal calls the vendor revoke APIs.
- **Every major page:** catalog, product detail, cart, checkout, order history, wishlist, dashboard — rendered, interacted with, and asserted against real component markup.

> **Note on the stress test:** the Playwright monkey script runs and is reproducible with `npm run test:monkey`, and its first run surfaced a real defect — the cookie settings modal swallowed clicks and could not be dismissed from the keyboard, which has since been fixed. Its final assertion is currently a placeholder and its last full run was made against the deployed API rather than a local one, so it is best described as an exploration tool at this point, not a pass/fail gate. Tightening it is tracked in the audit notes.

### Bugs found and fixed through testing

A few examples from [`docs/fixes-2026-09.md`](./tresse_backend/docs/fixes-2026-09.md):

- **Back-in-stock notifications were connected to nothing.** The `post_save` receiver existed and had tests, but `ProductsConfig.ready()` was empty, so the decorator never ran and no email was ever sent. The tests passed only because `mock.patch` imported the module as a side effect. Worse, the handler's only guard was `quantity > 0` — connecting it as-is would have emailed every waiting subscriber each time stock was *decremented* after a purchase. Fixed together: wired up in `ready()`, guarded to fire only on a zero-to-positive transition, and moved into `transaction.on_commit`.
- **Profile updates silently did nothing.** The serializer declared camelCase fields while the frontend sent snake_case; DRF dropped the unknown keys, the API returned `200`, and the UI showed "Saved." Name, address line and postal code never reached the database — masked by a localStorage copy that made it look like it had worked. Reproduced with a test using the exact payload the form sends, then fixed.
- **Sessions died 30 minutes after login, mid-checkout.** The backend rotates and blacklists refresh tokens; the frontend read only `access` from the refresh response and kept sending the blacklisted refresh token, so the second refresh always failed.
- **A focus-management race condition silently truncated user input** in modal forms. Every parent re-render handed the dialog a fresh close-handler reference, re-triggering a focus effect that yanked focus back after each keystroke. Fixed by holding the handler behind a ref, and generalized into the shared dialog hook now used by every modal.

---

## Audit

In September 2026 the codebase was put through a full pre-launch audit — every backend app, frontend component, config file, email template and test read end to end — producing **81 findings** ranked P0 to P3.

All P0 (release blockers) and all but one P1 are now closed, each as its own commit with tests and a written entry explaining what broke, why it mattered, and how it was verified:

- [`tresse_backend/docs/fixes-2026-09.md`](./tresse_backend/docs/fixes-2026-09.md)
- [`tresse_frontend/docs/fixes-2026-09.md`](./tresse_frontend/docs/fixes-2026-09.md)

Not every finding survived contact with the code. Three were withdrawn after reading further — a suspected lost surcharge turned out to be correctly snapshotted server-side, and a flagged config "typo" turned out to be valid syntax. Those reversals are documented too.

---

## Getting Started

### Prerequisites
- Python 3.12+, Node 22+, PostgreSQL

### Backend
```bash
cd tresse_backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # fill in SECRET_KEY, DB credentials, Stripe test keys, etc.
python manage.py migrate
python manage.py runserver
```

### Frontend
```bash
cd tresse_frontend
npm install
cp .env.example .env      # fill in VITE_API_URL, Stripe publishable key, etc.
npm run dev
```

### Running the test suite
```bash
# Backend
cd tresse_backend
pytest
ruff check . && ruff format --check .

# Frontend
cd tresse_frontend
npm run test:run        # unit/integration tests
npx tsc --noEmit        # type check
npm run lint            # Biome, including accessibility rules
npm run test:monkey     # randomized stress test
```

---

## Project Structure

```
tresse-ecommerce/
├── tresse_backend/              Django REST API
│   ├── accounts/                 Auth, profiles, admin 2FA
│   ├── orders/                    Orders, Stripe checkout & webhooks, returns
│   ├── products/                   Catalog, cart, wishlist, stock signals
│   ├── newsletter/                 Subscribe, signed-token unsubscribe
│   ├── templates/emails/           Transactional email templates
│   └── docs/                       Audit fix log
├── tresse_frontend/              React + TypeScript SPA
│   ├── src/
│   │   ├── components/             Auth forms, modals, cookie consent
│   │   ├── view/                    Page-level components
│   │   ├── store/                    Redux slices
│   │   ├── hooks/                     Shared dialog/focus behaviour
│   │   ├── utils/                      Pixel loaders, storage, API client
│   │   └── api/                         Axios client & endpoints
│   ├── e2e/                        Playwright stress test
│   └── docs/                       Audit fix log
└── .github/workflows/            CI (backend + frontend)
```

---

## License

MIT — see [LICENSE](./LICENSE) for details.

---

<div align="center">

Built by [Kseniia Rostovskaia](https://kseniiaross.dev)

LinkedIn: https://www.linkedin.com/in/kseniia-rostovskaia

</div>