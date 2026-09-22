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
| **Frontend (stress test)** | Playwright | 150 seeded randomized actions — clicks, garbage input, navigation, modal toggling; fails on any unhandled page error or 5xx response | ✅ passing |
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

> **The stress test** is seeded and reproducible with `npm run test:monkey`. It walks the app with 150 random actions — clicks, navigation, and deliberately malformed form input such as extreme-length numbers, null bytes and control characters — and fails on any unhandled page error or 5xx response. A preflight check aborts immediately if the local API isn't reachable, so a broken environment can't masquerade as a passing run, and Playwright traces are captured on retry. Its first run surfaced a modal that swallowed clicks and couldn't be dismissed from the keyboard; its most recent run surfaced a 500 on the catalog endpoint caused by an unguarded image URL — both since fixed.

### Bugs found and fixed through testing

A few examples from [`docs/fixes-2026-09.md`](./tresse_backend/docs/fixes-2026-09.md):

- **Back-in-stock notifications were connected to nothing.** The `post_save` receiver existed and had tests, but `ProductsConfig.ready()` was empty, so the decorator never ran and no email was ever sent. The tests passed only because `mock.patch` imported the module as a side effect. Worse, the handler's only guard was `quantity > 0` — connecting it as-is would have emailed every waiting subscriber each time stock was *decremented* after a purchase. Fixed together: wired up in `ready()`, guarded to fire only on a zero-to-positive transition, and moved into `transaction.on_commit`.
- **Profile updates silently did nothing.** The serializer declared camelCase fields while the frontend sent snake_case; DRF dropped the unknown keys, the API returned `200`, and the UI showed "Saved." Name, address line and postal code never reached the database — masked by a localStorage copy that made it look like it had worked. Reproduced with a test using the exact payload the form sends, then fixed.
- **A 500 on the whole catalog, caused by one image.** `get_image_url` called `.url` on a file field with no guard, unlike the main-image helper sitting right next to it. Any storage hiccup took the entire catalog response down instead of dropping a single picture. Found by the stress test, not by a human clicking around.
- **Sessions died 30 minutes after login, mid-checkout.** The backend rotates and blacklists refresh tokens; the frontend read only `access` from the refresh response and kept sending the blacklisted refresh token, so the second refresh always failed.

---

## Audit

In September 2026 the codebase was put through a full pre-launch audit — every backend app, frontend component, config file, email template and test read end to end — producing **81 findings** ranked P0 to P3.

Every P0 and P1 is now closed, each as its own commit with tests and a written entry explaining what broke, why it mattered, and how it was verified:

- [`tresse_backend/docs/fixes-2026-09.md`](./tresse_backend/docs/fixes-2026-09.md)
- [`tresse_frontend/docs/fixes-2026-09.md`](./tresse_frontend/docs/fixes-2026-09.md)

Not every finding survived contact with the code. Three were withdrawn after reading further — a suspected lost surcharge turned out to be correctly snapshotted server-side, and a flagged config "typo" turned out to be valid syntax. Those reversals are documented too.

### How the work was done

The audit and the fixes were done with AI assistance — Claude for the codebase review, Claude Code for the implementation — under a process designed to keep the output verifiable:

- **One task, one prompt, one commit.** Every prompt fixed the scope, named the files, and listed the acceptance checks (pytest / Vitest, `tsc --noEmit`, Ruff, Biome). Every task ends with a written entry in the fix log.
- **Tests had to fail first.** A fix was accepted only once its test was shown to fail against the pre-fix code. For anything touching money the standing instruction was: *if a test exposes a real bug, stop and report it instead of fixing it* — so tests could never be bent to match the code.
- **Every diff was reviewed before it was committed,** and out-of-scope changes were rejected. One suggested tooling change made the linter start rewriting files in `dist/`; it was caught in review and reverted.
- **Manual verification for what tests can't prove:** pixel requests in the browser Network tab, the production admin, real email delivery, the live Stripe dashboard.
- **Three audit findings were withdrawn** after reading further. Verifying the report mattered as much as acting on it.
- **Product and policy decisions stayed human:** the 30-day restore window, US-only shipping, free domestic delivery priced into the garment, 2FA on the admin but not on customer accounts.

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
npm run test:monkey     # randomized stress test (needs the backend running)
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