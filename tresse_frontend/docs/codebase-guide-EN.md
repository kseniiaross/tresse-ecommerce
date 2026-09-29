# TRESSE Frontend — Codebase Guide

A file-by-file walkthrough of `tresse_frontend/src`, plus the top-level
config files, written for interview prep. Every claim below is checked
against the current code (not the audit's predictions, not a docs entry) —
where a file calls the backend, the matching Django view/serializer in
`tresse_backend` is cited by name. Anything that couldn't be confirmed
from the code itself is marked **unverified**. Five backend sections
(newsletter, email templates, accounts, products, orders) are covered in
the same depth as the frontend, since the frontend sections that call
into them deserve the other half of the story spelled out rather than
left as a "Backend:" name-drop — see Backend — newsletter, Backend —
email templates, Backend — accounts, Backend — products, and Backend —
orders below, and the four full-stack walkthroughs in How the pieces
fit.

Stack reminder: React 19 + Vite 7, Redux Toolkit, React Router v6, Axios,
Vitest + Testing Library, Playwright, Biome for lint/format on the
frontend; Django + Django REST Framework, SimpleJWT, Stripe, Resend
(via `django-anymail`) on the backend.

---

## Entry point and app shell

`main.tsx`, `App.tsx`, and `index.html` are the only files that bootstrap
the app itself — mounting React, wiring the router, registering global
providers and one-time effects. Anything that renders a specific page
belongs in `view/`; anything reusable across pages belongs in
`components/`. Two nearly-empty top-level files, `App.css` and
`index.css`, and two ambient type-declaration files, `env.d.ts` and
`vite-env.d.ts`, round out this group because they're imported directly
by these three files and don't belong to any other folder.

### `src/main.tsx`

**What it is:** The real entry point — the only file that calls
`ReactDOM.createRoot(...).render(...)`.

**Why it exists:** Something has to mount the React tree and wire up the
one piece of global plumbing that has to exist *before* any component
renders: the "you got logged out" callback that clears the wishlist
count.

**What it exports:** Nothing — it's a script, referenced by `<script
type="module" src="/src/main.tsx">` in `index.html`.

**How it works:** Three steps, in order: (1) `setOnUnauthorized(() =>
store.dispatch(setCount(0)))` — registers a callback on the Axios
instance's module-level `onUnauthorized` slot so that when a request
comes back 401, the wishlist badge count resets to 0 immediately, before
React has even rendered; (2) `ReactDOM.createRoot(...)` mounts `<App />`
inside `<Provider store={store}>` inside `<React.StrictMode>`.
`React.StrictMode` double-invokes effects and render in development to
surface impure code — it has no effect in production builds.

**What it talks to:** `./api/axiosInstance` (`setOnUnauthorized`), `./store`
(the Redux store), `./store/wishListSlice` (`setCount`), and the DOM node
`#root` from `index.html`.

**Watch out for:** `App.tsx` *also* calls `setOnUnauthorized(...)` in its
own `useEffect`, with a different callback (`dispatch(logout())` plus a
redirect) — and since `setOnUnauthorized` just overwrites one
module-level variable, whichever call runs last wins. `App.tsx`'s
`useEffect` runs after `main.tsx`'s render call completes, so in practice
`App.tsx`'s handler (the logout+redirect one) is what actually fires on a
401 — `main.tsx`'s wishlist-reset handler is silently replaced and never
runs. Confirmed by reading both call sites: neither composes with the
other, there's only one slot. This is the mechanism audit item P2-03
("Two `setOnUnauthorized` handlers compete for one slot") describes, and
it's still exactly the current behavior — the wishlist count is not part
of `App.tsx`'s own handler, so after a forced logout the header can keep
showing a stale saved-items count until something else refreshes it.

**Interview questions:**
- *Q: Why does `main.tsx` register an unauthorized callback before
  rendering anything?* — So the slot has *some* handler as early as
  possible, in case a request 401s during the very first render. In
  practice `App.tsx`'s own `useEffect` overwrites it a moment later.
- *Q: What does `React.StrictMode` actually change here?* — Nothing in
  production; in development it renders components and runs effects
  twice to catch side effects that aren't idempotent. It doesn't wrap
  anything in extra DOM.

---

### `src/App.tsx`

**What it is:** The router, the route table, and the home for every
app-wide one-time effect (auth bootstrap, the real unauthorized handler,
marketing-pixel init).

**Why it exists:** Something has to own the single `<BrowserRouter>`,
declare every route once, and run the handful of effects that must fire
exactly once per app load regardless of which page the user landed on —
restoring a session from `localStorage`, deciding what "logged out"
means, and initializing Meta/TikTok pixels if consent already exists.

**What it exports:** `export default function App()`. Only ever
consumed by `main.tsx`.

**How it works:**
- **Session bootstrap** (first `useEffect`, deps `[dispatch]`): reads
  `localStorage.getItem("access")` and `getItem("user")` directly
  (not through `types/token.ts`'s helpers — see Watch out for). If both
  exist and the stored user JSON parses into something shaped like a
  `User` (checked by the local `toUserOrNull` — requires a positive
  numeric `id` and an `email` containing `"@"`), it dispatches
  `setCredentials({ token, user })`, then `fetchCart()` and
  `fetchWishlistCount()` to hydrate server state for an already-logged-in
  visitor. If the stored user JSON doesn't parse or doesn't validate, it
  dispatches `logout()` instead — so a corrupted or hand-edited
  `localStorage.user` value forces a clean logged-out state rather than
  crashing.
- **The real unauthorized handler**, registered in the same effect right
  after bootstrap: `dispatch(logout())`, then compute `next =
  pathname + search` and redirect via `window.location.assign` to
  `/login-choice?next=<encoded next>` — but only if the current path
  isn't already one of the auth pages (`/authorization`, `/register`,
  `/login-choice`, `/reset-password`, `/login`, `/account/restore`),
  which stops a 401 on, say, the login page itself from bouncing the
  user in a redirect loop. `isSafeNextPath` requires the path to start
  with `/` and not `//` — a minimal open-redirect guard (a `next` value
  like `//evil.com` would be interpreted by some browsers as
  protocol-relative and is explicitly rejected). The effect's cleanup
  calls `setOnUnauthorized(null)`, clearing the slot on unmount (which in
  practice never happens for the root `<App />`).
- **Marketing pixels** (second `useEffect`, empty deps): calls
  `initMarketingPixels()` once. See `utils/pixelLoader.ts`.
- **`ScrollToTop`**, a local component rendered once inside `<Router>`:
  on every `pathname`/`search` change it scrolls to top, *unless* the URL
  has a `hash`, in which case it scrolls the matching element into view
  instead (`document.getElementById(hash.slice(1))`). Uses
  `useLayoutEffect` (not `useEffect`) so the scroll happens before the
  browser paints the new route, avoiding a visible flash of the old
  scroll position.
- **`OrderRouteWithStripe`**, a local component wrapping `<Order />`:
  dynamically `import("./features/payments/stripe")` on mount (code-split
  so Stripe's SDK isn't in the main bundle for visitors who never check
  out), shows `"Loading checkout…"` until the promise resolves, then
  renders `<Elements stripe={stripePromise}><Order /></Elements>`.

**What it exports as routes:** every page in `view/` and
`view/policies/` is mapped to a path here — this is the single source of
truth for the app's URL structure. Notably: `/order/success` is public
(no `PrivateRoute`) even though `/order` itself requires auth, since a
Stripe redirect back to the success page shouldn't require a live
session; `/newsletter/unsubscribe/:token` and
`/account/restore/:uidb64/:token` are public by design (both are reached
from an emailed link, not from being logged in).

**What it talks to:** `./api/axiosInstance` (`setOnUnauthorized`),
`./store` (dispatch), `./store/serverCartSlice` (`fetchCart`),
`./store/wishListSlice` (`fetchWishlistCount`), `./utils/authSlice`
(`logout`, `setCredentials`), `./utils/PrivateRoute`,
`./utils/pixelLoader` (`initMarketingPixels`),
`./hooks/useAuthStorageSync`, `localStorage` directly (bootstrap only),
and `window.location` (redirect on 401, read in `ScrollToTop`).

**Watch out for:**
- The bootstrap effect reads `localStorage` directly with
  `localStorage.getItem("access")`/`getItem("user")` instead of going
  through `types/token.ts`'s `getAccessToken()` — both read the same
  `"access"` key today, so this works, but it means the key name is
  duplicated in two places instead of centralized in the one module whose
  own comment says it's "the single source of truth" for token storage.
- `useAuthStorageSync()` (see `hooks/`) is called unconditionally at the
  top of `App`, before any of the effects above — it listens for
  cross-tab storage events, not for anything `App.tsx` itself writes.
- See `main.tsx`'s "Watch out for" above: this file's `setOnUnauthorized`
  call is the one that wins in practice, silently overriding
  `main.tsx`'s wishlist-reset handler.
- `React.StrictMode` (set in `main.tsx`) double-invokes `App`'s effects
  in development — the bootstrap effect's `dispatch`s are idempotent
  (dispatching `setCredentials` or `logout` twice is harmless), so this
  doesn't cause a visible bug, but it's why a `console.log` placed in
  that effect appears to fire twice locally.

**Interview questions:**
- *Q: Why is `/order/success` not behind `PrivateRoute` when `/order` is?*
  — Because the user arrives there via a server-side redirect from
  Stripe after paying, not by clicking a link while authenticated in this
  tab/browser — requiring a live session on that specific redirect would
  strand a legitimately-paying customer.
- *Q: Why does `ScrollToTop` use `useLayoutEffect` instead of
  `useEffect`?* — `useLayoutEffect` runs synchronously after DOM
  mutations but before the browser paints, so the scroll position is
  already correct in the very first frame of the new route; `useEffect`
  would let the browser paint the old scroll position for one frame
  first, causing a visible jump.
- *Q: What stops a malicious `?next=` value from being used to redirect a
  user off-site after a forced logout?* — `isSafeNextPath`, which
  requires the value to start with a single `/` and rejects one starting
  with `//` (which browsers can treat as a protocol-relative URL to a
  different host).
- **Harder follow-up:** *Q: Two different files call
  `setOnUnauthorized()` with two different callbacks. Walk through what
  actually happens when a request 401s, in terms of call order and final
  state.* — A: `setOnUnauthorized` just does `onUnauthorized = cb` on one
  module-level variable in `api/axiosInstance.ts` — there's no
  list/queue, so the second call fully replaces the first. `main.tsx`
  calls `ReactDOM.createRoot(...).render(<App />)` *after* its own
  `setOnUnauthorized` call, and React's render doesn't run `App`'s
  effects synchronously — but `App`'s `useEffect` still fires very soon
  after, before any user interaction, so by the time a real request could
  401, `App.tsx`'s handler (logout + redirect, no wishlist reset) is the
  one installed. `main.tsx`'s handler never actually runs in normal app
  usage.

---

### `index.html`

**What it is:** The Vite HTML entry point — the actual page the browser
loads before any JS runs.

**Why it exists:** Vite treats this file as a build entry: it's scanned
for `<script type="module">` tags (here, `/src/main.tsx`) to know where
the JS graph starts, and everything else in `<head>` is static markup
Vite passes through untouched.

**What it exports:** N/A — it's markup, not a module.

**How it works / what it talks to:** Sets `<meta charset>`, viewport,
theme color, a Facebook domain-verification meta tag
(`facebook-domain-verification`), a Google Fonts `<link>` for "Playfair
Display" (loaded from `fonts.googleapis.com` — a genuine third-party
request on every page load, unrelated to the self-hosted
`tresse_font.woff2` declared in `styles/variables.css`), a favicon link,
and a full set of Open Graph / Twitter card meta tags pointing at
`https://tressehandmade.com/` and `https://tressehandmade.com/og-image.jpg`.

**Watch out for:** This file carried the Meta Pixel and TikTok Pixel
bootstrap `<script>` snippets (running unconditionally, before any
consent check) until the [[P0-07]] fix — the current file has **no**
inline pixel scripts and no Facebook `<noscript>` image at all; that
logic now lives entirely in `src/utils/pixelLoader.ts`, gated on cookie
consent and invoked from `App.tsx`. If you're reading an older version of
this file or a written report that describes pixel snippets living here,
that's stale — verify against the actual file. Separately, the Open
Graph `og:url`/`og:image` domain (`tressehandmade.com`) is the
storefront domain, distinct from `tresseknitting.com`, which the backend
uses for `DEFAULT_FROM_EMAIL`/`SUPPORT_EMAIL` (see
`tresse_backend/docs/fixes-2026-09.md`, P1-16) — two different domains by
design, not a leftover mismatch, as long as one is the storefront and the
other stays the support mailbox.

**Interview question:** *Q: Why does Vite need `index.html` at the
project root instead of treating it as a static asset?* — Vite's dev
server and build both start dependency resolution from HTML entry
points — the `<script type="module" src="/src/main.tsx">` tag is what
tells Vite "start bundling here," which is different from a traditional
bundler config that names an entry file directly.

---

### `src/App.css`

**What it is:** Referenced by `App.tsx` (`import "./App.css"`).

**Why it exists / how it works:** It doesn't — the file is **empty** (0
bytes). It's imported for its side effect (none) and presumably was
meant to hold app-shell-specific styles that ended up living in
`index.css` and `styles/base.css` instead.

**Watch out for:** An empty, imported stylesheet is harmless but
pointless — matches audit item P3-30.

**Interview question:** *Q: What does removing this import change?* —
Nothing observable; the file has no rules.

---

### `src/index.css`

**What it is:** Imported once, from `main.tsx`. The real root of the
CSS cascade for the whole app.

**Why it exists:** Something has to `@import` the design tokens and base
element styles before any component-level CSS loads, and own the
handful of page-shell rules (`body`, `#root`, `.layout`, `.layout-main`,
`.header-offset`) that don't belong to any single page or component.

**How it works:** `@import "../styles/variables.css"` then `@import
"../styles/base.css"` — order matters, since `base.css` uses the custom
properties `variables.css` defines. Then: `body { overflow-x: hidden }`
(prevents horizontal scroll from any element that briefly overflows);
`#root { min-height: 100dvh }`; `.layout` is a column flexbox filling at
least the viewport height (footer stays at the bottom on short pages);
`.layout-main` is `flex: 1 0 auto` so it grows to push the footer down,
and carries `padding-top: var(--header-height)` to clear the fixed
header; `.header-offset` is a plain spacer element some pages render
manually to reserve header height without relying on `.layout-main`'s
padding.

**What it talks to:** `styles/variables.css`, `styles/base.css`, and the
`--header-height` custom property they define.

**Interview question:** *Q: Why is `.layout-main` given both `flex: 1 0
auto` and a `padding-top`?* — The flex rule makes it grow to fill leftover
vertical space so the footer doesn't ride up on short pages; the padding
is unrelated — it just reserves space for the fixed-position header so
page content doesn't render underneath it.

---

### `src/env.d.ts` and `src/vite-env.d.ts`

Two ambient type-declaration files, neither exporting a runtime value.

- **`src/env.d.ts`** declares `ImportMetaEnv` with one member,
  `VITE_STRIPE_PUBLIC_KEY: string`, and augments the global `ImportMeta`
  interface with it — this is what gives
  `import.meta.env.VITE_STRIPE_PUBLIC_KEY` (used in
  `features/payments/stripe.ts`) a type instead of `any`. **Watch out
  for:** it only declares that one variable, but the code actually reads
  several others via `import.meta.env` (`VITE_API_URL`,
  `VITE_BACKEND_URL` in both `axiosInstance.ts` files) — those are
  untyped/`any` at the type level; TypeScript doesn't catch a typo in
  those names.
- **`src/vite-env.d.ts`** is the standard Vite scaffold file — a single
  triple-slash reference, `/// <reference types="vite/client" />`, which
  pulls in Vite's own ambient types (asset imports like `*.svg`, the base
  `ImportMetaEnv` shape, etc.). `env.d.ts` above *augments* what this
  file declares rather than replacing it.

**Interview question:** *Q: Why are there two separate `.d.ts` files
instead of one?* — `vite-env.d.ts` is Vite's own scaffolded file (pulls in
its built-in ambient types); `env.d.ts` is where this project adds its
own env-var typing on top, via declaration merging on `ImportMetaEnv`.
Keeping them separate means a `vite upgrade` regenerating scaffold files
wouldn't necessarily overwrite project-specific env typing if it lived in
the same file — **unverified** whether that was the actual reason versus
just following the common convention unmodified.

---

## `api/`

Everything here wraps a specific backend call behind a typed function —
this folder is where HTTP happens. Anything that decides *when* to call
one of these functions, or holds the resulting state, belongs in
`store/` or in the component itself, not here. Critically: this folder
duplicates one file with `utils/` — see the `Watch out for` on
`api/axiosInstance.ts` below, expanded fully in the `utils/` section.

### `src/api/axiosInstance.ts`

**What it is:** The Axios instance every single part of the app actually
uses. Confirmed by a repo-wide search: every store slice, every view,
every component, and every other `api/*` helper imports `api`/
`axiosInstance` from here — `../api/axiosInstance` or `./axiosInstance`,
depending on the caller's location. There used to be a second,
near-identical file, `src/utils/axiosInstance.ts`, that nothing imported
(see the historical note under Watch out for) — it was deleted in commit
`934604b` ("Actually fix the token refresh — port it into the file the
app loads, and stop deleting the refresh token on login"), which moved
its refresh logic into this file instead. This is now the only
`axiosInstance.ts` in the codebase.

**Why it exists:** A single configured Axios client so every request
gets the same base URL, the same bearer token attached automatically,
and the same handling of an expired session — instead of every call site
reading `localStorage` and building headers by hand.

**What it exports:** `axiosInstance` (default export, generally imported
as `api`), `setOnUnauthorized(cb)`, and `getMediaRoot()`.

**How it works:**
- **Base URL:** `import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_URL
  || "http://127.0.0.1:8000"`, trailing slashes stripped, then `/api`
  appended unless the value already ends with it. In local dev with no
  env override, this points straight at `127.0.0.1:8000` — **not**
  through `vite.config.ts`'s `/api` and `/media` proxy entries (which
  target the same host anyway in dev, so the difference is invisible
  locally, but it means the proxy is effectively unused: every request
  leaves the Vite dev server process entirely rather than being
  forwarded).
- **Request interceptor:** reads the access token via
  `getAccessToken()` (from `types/token.ts`) and sets an `Authorization:
  Bearer <token>` header when one exists — unconditionally, on every
  request, including ones that don't need auth.
- **Response interceptor — refresh-and-retry:** on a `401`, if the
  failing request's URL doesn't start with one of a fixed `NO_AUTH` list
  (`/token/`, `/token/refresh/`, `/accounts/login/`,
  `/accounts/register/`, `/accounts/restore/request/`,
  `/accounts/restore/confirm/`) and the request hasn't already been
  retried once (a `_retry` flag set on the Axios config), it marks the
  request retried and attempts a token refresh before giving up:
  - If a refresh is already in flight (`isRefreshing`), the request is
    queued (`enqueueRefresh`) instead of starting a second one.
  - Otherwise it calls `refreshAccessToken()`, which reads the refresh
    token via `getRefreshToken()` (`types/token.ts`) and `POST`s
    `{refresh}` to `/accounts/token/refresh/` — deliberately through the
    plain `axios` module, not `axiosInstance`, so this call can't
    recurse back through the interceptor that's already handling this
    401. The backend's `TokenRefreshView` has `ROTATE_REFRESH_TOKENS`
    and `BLACKLIST_AFTER_ROTATION` enabled (`tresse_backend/tresse/
    settings.py`), so the refresh token just used is blacklisted the
    instant it's read — `refreshAccessToken` stores the new access token
    via `setAccessToken` and, if the response included one, the rotated
    refresh token via `setRefreshToken`, so the *next* refresh has a
    still-valid token to use.
  - Once a refresh resolves, every queued request (`resolveQueue`) and
    the request that triggered it are replayed with the new access
    token. A `401` on an already-retried request, or a failed refresh
    (no refresh token stored, or the refresh call itself erroring),
    calls whatever callback `setOnUnauthorized` last registered and
    rejects.
  - Any other error status, a `NO_AUTH` URL, or a missing request config
    is re-thrown immediately (`Promise.reject(err)`) with no refresh
    attempt, so the calling code's own `catch`/`.catch()` still runs.
- **`getMediaRoot()`:** strips a trailing `/api` off the configured
  `baseURL` to get the plain host — used wherever the app needs to build
  a media/static URL rather than an API path (**unverified** which
  specific call sites use it; not observed as imported elsewhere in this
  read-through — search the repo if this matters for a specific claim).

**What it talks to:** `types/token.ts` (`getAccessToken`,
`getRefreshToken`, `setAccessToken`, `setRefreshToken` — all four now,
where this file previously only ever read `getAccessToken`), plain
`axios` (for the refresh call specifically, bypassing this instance's
own interceptors on purpose), and every backend endpoint indirectly,
through every other module that imports it.

**Watch out for:**
- **`_retry` is a boolean, not a counter.** A request that gets a `401`,
  is refreshed and replayed, and then gets a *second* `401` is not
  refreshed again — it falls straight into the already-retried branch
  and triggers `onUnauthorized()`. This bounds refresh attempts to one
  per request (so a genuinely expired/blacklisted refresh token can't
  loop forever) at the cost of not distinguishing "the new access token
  was also rejected" from "the refresh never happened."
- **Historical note, since this is a common thing to be asked about
  directly:** this file used to have no refresh logic at all, and an
  earlier fix for "sessions die after ~30 minutes" ([[P0-11]] in
  `docs/fixes-2026-09.md`) had been written into `src/utils/
  axiosInstance.ts` instead — a file nothing in the app imported, so the
  fix was real, tested code that never actually ran in production. That
  file also deleted the stored refresh token on every login (`utils/
  authSlice.ts`'s `setCredentials` was called without a `refresh` field
  from `Authorization.tsx`/`Register.tsx`), so even routing the app at
  the correct file wouldn't have been enough on its own. `934604b` fixed
  both halves together: the refresh-and-retry logic above now lives in
  the file the app actually loads, and `Authorization.tsx`/`Register.tsx`
  now pass `refresh` through to `setCredentials` so it survives login
  (see those files' own sections). `axiosInstance.test.ts` covers the
  fixed behavior directly, against a scriptable fake transport rather
  than a full mock of this module: refresh-then-replay on a single 401;
  the rotated access *and* refresh tokens both get stored; two
  concurrent 401s share one in-flight refresh (`postSpy` called exactly
  once) and both original requests still resolve with their own data; a
  failing refresh calls `onUnauthorized` exactly once even when two
  requests failed at the same time; and a `NO_AUTH` route never attempts
  a refresh at all.
- The `NO_AUTH` list's exemption only controls whether a `401`
  short-circuits straight to `onUnauthorized`/refresh handling — the
  request interceptor still attaches whatever bearer token exists to
  *every* request, `NO_AUTH` ones included, which is harmless since
  there's normally no token yet at login/register/refresh time.

**Interview questions:**
- *Q: What happens when an access token expires while the user is
  browsing?* — The next request that hits a protected endpoint gets a
  `401`; the response interceptor sees the URL isn't on the `NO_AUTH`
  list, marks the request retried, and — transparently, with no visible
  interruption — refreshes the access token (rotating the refresh token
  along with it) and replays the original request. The user notices
  nothing unless the refresh itself fails, in which case the registered
  `onUnauthorized` callback runs (per `App.tsx`, logs the user out and
  redirects to `/login-choice`).
- *Q: Why must the refresh call use plain `axios` instead of
  `axiosInstance`?* — So it never runs back through the same response
  interceptor that's currently handling this `401` — using
  `axiosInstance` here would risk the refresh call itself triggering
  another refresh attempt if it ever came back with a `401`.
- *Q: Why queue concurrent requests behind one in-flight refresh instead
  of letting each failed request start its own?* — Because the backend
  blacklists a refresh token the moment it's used. Two simultaneous
  refresh calls would both try to use the same (about-to-be-invalidated)
  refresh token — one would win and the other would fail, or worse, race
  on which rotated token ends up stored — so only one refresh may run at
  a time; every other request that fails while it's in flight queues
  behind it and replays once it resolves.
- **Harder follow-up:** *Q: This codebase used to have two files named
  `axiosInstance.ts`, and the fix for a real production bug had been
  written into the one nothing imported. How would you check, with
  certainty, that a fix like this actually landed in the file the app
  uses?* — A: Grep every `import` of `axiosInstance` across `src/`
  (excluding test files, which sometimes mock it) and check the literal
  import path each caller uses, and separately check for a bundler/
  tsconfig path alias that could make two different filenames resolve to
  the same module. Today that audit comes back clean — there's only one
  file left to find — but the same two checks (import-site audit + alias
  check) are what would have caught the original problem before it
  shipped, and are worth repeating after any fix like this rather than
  trusting that the correct-looking file is the one that's loaded.

---

### `src/api/auth.ts`

**What it is:** Four typed functions wrapping the unauthenticated auth
endpoints: `loginUser`, `registerUser`, `requestAccountRestore`,
`confirmAccountRestore`.

**Why it exists:** Centralizes both the request shape *and* a consistent
error-message extraction strategy (`getErrorMessage`) so every caller
gets a plain `Error` with a human-readable `.message` instead of having
to parse a Django REST Framework error response itself.

**What it exports:** `loginUser(data)`, `registerUser(data)`,
`requestAccountRestore(email)`, `confirmAccountRestore({uidb64, token,
new_password})`. Imported by `components/Authorization.tsx`,
`components/Register.tsx`, and `components/AccountRestore.tsx`
(**unverified** by direct read in this pass — inferred from the
functions' purpose and this app's route table; confirm against those
files' own imports if precision matters).

**How it works:**
- `loginUser` → `POST /accounts/token/` with `{email, password}`. Backend:
  `CustomTokenObtainPairView` (`accounts/urls.py`, `name="token_obtain_pair"`),
  a `TokenObtainPairView` subclass using `CustomTokenObtainPairSerializer`
  — which sets `username_field = "email"`, refuses an inactive user with
  a `{"detail": "Account is deactivated..."}` validation error, and adds
  a `user: {id, email, first_name, last_name}` object into the standard
  SimpleJWT `{access, refresh}` response (**per the serializer read while
  researching the fixes doc** — re-verify directly if this file is
  audited on its own).
- `registerUser` → `POST /accounts/register/`, whole payload passed
  through as-is. Backend: `RegisterAPIView`, `AllowAny`, throttled by
  `RegisterAnonThrottle` + `RegisterUserThrottle`, optionally checks a
  `captcha_token` if reCAPTCHA is enabled server-side, then validates via
  `RegisterSerializer` and creates the user.
- `requestAccountRestore` → `POST /accounts/restore/request/` with
  `{email: email.trim().toLowerCase()}` — normalizes casing/whitespace
  client-side before sending. Backend: `AccountRestoreRequestAPIView`.
- `confirmAccountRestore` → `POST /accounts/restore/confirm/` with
  `{uidb64, token, new_password}`. Backend:
  `AccountRestoreConfirmAPIView`, which (per [[P1-17]]) now runs Django's
  `validate_password` on `new_password` rather than only checking its
  length.
- **`getErrorMessage(error, fallback)`:** only unwraps a message if
  `isAxiosError(error)` is true; otherwise returns `fallback` outright.
  For an Axios error, it checks, in order: `response.data.detail` (string,
  or first element if an array — DRF sends both shapes depending on the
  exception type), then `response.data.non_field_errors[0]`, then the
  first non-empty value among a fixed list of field names
  (`email`, `password`, `current_password`, `new_password`,
  `confirm_password`) — string or array's first element — then
  `error.message`, then finally the caller-supplied `fallback`.

**What it talks to:** `api/axiosInstance.ts` (as `api`), `types/auth.ts`
(request/response types).

**Watch out for:** `getErrorMessage`'s priority order is deliberate and
tested (`api/auth.test.ts`'s last `describe` block pins it explicitly) —
`detail` always wins over `non_field_errors`, which always wins over a
named field. Changing that order would silently change which message a
user sees when a backend response happens to include more than one error
key.

**Interview questions:**
- *Q: Why does `getErrorMessage` check several different response shapes
  instead of just reading `response.data.detail`?* — Because Django REST
  Framework doesn't always put the error there — a serializer's
  `validate()` raising a plain string produces `non_field_errors`, and a
  field-level validator (e.g. on `email` or `password`) produces a key
  named after that field — so a single fixed lookup would miss most
  validation errors and fall through to a generic fallback message.
- *Q: What happens if the backend returns a 500 with no JSON body at
  all?* — `error.response?.data` would be `undefined`/not an object, so
  none of the shape checks match; it falls through to `error.message`
  (Axios's own generic message, e.g. "Request failed with status code
  500"), and only if that's empty does it use the caller's `fallback`
  string.
- **Harder follow-up:** *Q: `requestAccountRestore` normalizes the email
  client-side before sending it. Does removing that normalization break
  anything server-side?* — No — `AccountRestoreRequestAPIView` (like the
  rest of `accounts`) normalizes email server-side too; the client-side
  trim/lowercase is purely so the request the test asserts on
  (`api/auth.test.ts`) is predictable and so a user typing extra
  whitespace or mixed case doesn't visibly differ in, e.g., a browser
  devtools request log — not a security boundary, since the backend
  can't trust client-side normalization anyway.

---

### `src/api/auth.test.ts`

**What it mocks:** `./axiosInstance` (`api/axiosInstance.ts`) is fully
mocked to `{ default: { post: vi.fn() } }` via `vi.mock` — no real HTTP
happens, and none of the interceptor logic in the real file runs.

**What it asserts:** Each of the four functions in `auth.ts` posts to the
exact expected path with the exact expected body shape (including the
email-normalization in `requestAccountRestore`), returns
`response.data` unchanged on success, and throws an `Error` whose message
matches what `getErrorMessage` should produce for a given mocked error
shape. A dedicated `describe("getErrorMessage priority order...")` block
(via `loginUser`, since `getErrorMessage` isn't exported directly) pins
the exact precedence — `detail` string > `detail` array's first item >
`non_field_errors` > a known field error > `error.message` > the
fallback string — with one test per rung of that ladder.

**Interview question:** *Q: Why test `getErrorMessage`'s priority order
through `loginUser` instead of exporting and testing the function
directly?* — It's not exported — keeping it private to the module and
testing it through the public functions that actually use it means the
test suite only pins behavior that's externally observable, not an
internal implementation detail that's free to be refactored.

---

### `src/api/products.ts`

**What it is:** One function, `fetchProducts`, wrapping the product list
endpoint.

**Why it exists:** Centralizes the query-param shape for product
search/filter/sort/pagination so every caller (currently
`view/ProductCatalog.tsx`, by inference from the page's purpose —
**unverified** by direct read of that file in this pass) builds the same
kind of request.

**What it exports:** `Paginated<T>` (generic `{count, next, previous,
results}` DRF-pagination shape), `FetchProductsParams`, `fetchProducts`.

**How it works:** `GET /products/` with `params` passed straight through
(`search`, `category`, `collection`, `page`, `page_size`, `in_stock`,
`ordering`, `min_price`, `max_price` — all optional) and an `AbortSignal`
forwarded so a caller can cancel an in-flight request (e.g. when the user
types a new search query before the previous one resolves). Backend:
`ProductViewSet` (a `ReadOnlyModelViewSet` registered at the router root
in `products/urls.py`, so `list()` serves `GET /products/`), using
`ProductFilter` (`filterset_class`) for `category`/`collection` and DRF's
filter backends for `search_fields = ["name", "description"]` and
`ordering_fields = ["price", "created_at", "name", ...]`, paginated by
`ProductPagination`.

**What it talks to:** `api/axiosInstance.ts`, `types/product.ts`.

**Watch out for:** The audit's P2-08 finding — `products/views.py`'s
`get_queryset` also filters `category`/`collection` by hand, in addition
to `ProductFilter`, and only `ProductFilter` knows the `women → woman`
style aliasing — is a backend-side concern, but it means a
`category` value that works through this function might return an empty
result if the manual code path is the one that ends up applied;
**unverified** whether that's still true in the current `products/views.py`
without re-reading it directly in this pass.

**Interview question:** *Q: Why forward an `AbortSignal` into `fetchProducts`
instead of always letting a stale request finish?* — So a caller (e.g. a
search box) can cancel a request that's no longer relevant — typing a new
character issues a new request and cancels the old one, avoiding a race
where an older, slower response overwrites the UI after a newer one
already rendered.

---

### `src/api/account/ChangePassword.ts`

**What it is:** One function, `changePassword`, in its own
sub-folder (`api/account/`) rather than alongside the other `api/*.ts`
files.

**Why it exists:** Wraps `POST /accounts/change-password/`.

**What it exports:** `ChangePasswordPayload` (`{current_password,
new_password, confirm_password}`), `changePassword(payload)` — returns
`void` (the caller only cares whether the promise rejects). Imported by
`components/PasswordChange.tsx` (by inference from the name and the
route table — **unverified** by direct read of that file's import
statement in this pass).

**How it works:** A single `await api.post("/accounts/change-password/",
payload)`, no error handling of its own — errors propagate to the
caller. Backend: `ChangePasswordAPIView`, `IsAuthenticated`, validates
via `ChangePasswordSerializer` (which checks `new_password ==
confirm_password`), then verifies `current_password` against
`request.user.check_password(...)` before saving.

**What it talks to:** `../axiosInstance` (i.e. `api/axiosInstance.ts`,
via a relative import one level up from `account/`).

**Watch out for:** No client-side password-confirmation check before the
request is sent — that validation happens only server-side, in
`ChangePasswordSerializer`, per the code above. **Unverified** whether
`PasswordChange.tsx` itself duplicates a client-side check.

**Interview question:** *Q: Why does this one function live in its own
`api/account/` sub-folder instead of next to `auth.ts`?* — **Unverified**
from the code alone — no comment explains it, and it's the only file
under `api/` with a sub-folder; it may simply be a naming collision
avoided (there's no `api/ChangePassword.ts` conflict either way) or an
inconsistency from incremental development rather than a deliberate
convention.

---

## `store/`

Redux Toolkit slices that own **server-derived** state — the logged-in
cart and the wishlist count, both of which are fetched from the backend
and can't be reconstructed from `localStorage` alone. The **guest** cart
(pre-login, `localStorage`-backed) is a separate slice that lives in
`utils/cartSlice.ts` instead — a naming split that matters: `store/` here
means "talks to the server," not "every piece of Redux state."

### `src/store/index.ts`

**What it is:** The actual `configureStore(...)` call and the two derived
types (`RootState`, `AppDispatch`) every typed hook and thunk in the app
depends on.

**Why it exists:** One place to assemble all four reducers
(`auth`, `serverCart`, `wishlist`, `cart`) into the store, so nothing
else has to know the full reducer map.

**What it exports:** `store`, `RootState` (`ReturnType<typeof
store.getState>`), `AppDispatch` (`typeof store.dispatch`). Imported
throughout the app, directly (`main.tsx`) and via the typed hooks in
`utils/hooks.ts`.

**Watch out for:** The `cart` key holds the **guest** cart
(`utils/cartSlice.ts`, the inline comment says so directly: "Guest cart
stored in localStorage (LS_KEY = \"guest_cart\")"), while `serverCart`
holds the **logged-in** cart (`store/serverCartSlice.ts`) — two
differently-shaped cart representations coexist in the store
simultaneously, and which one a given view reads from depends on whether
the user is authenticated. `view/Cart.tsx` is the file that has to
reconcile both (see the `view/` section).

**Interview question:** *Q: Why are there two separate cart slices
(`cart` and `serverCart`) instead of one that just changes its data
source?* — A guest with no account still needs a working cart
(`localStorage`-backed, synchronous, no network), while a logged-in
user's cart is server-authoritative (needs async thunks, loading/error
states, and has to survive across devices) — merging the two into one
slice would mean every reducer either branches on auth state internally
or wastes effort modeling fields (like server item ids) that don't exist
for a guest.

---

### `src/store/serverCartSlice.ts`

**What it is:** The authenticated user's cart — fetch, add, update
quantity, update measurements, remove, and the guest→server merge on
login.

**Why it exists:** Owns every network call the logged-in cart needs and
normalizes them into one slice of Redux state (`{cart, loading, error}`),
so `view/Cart.tsx` can just dispatch thunks and read state rather than
calling Axios itself.

**What it exports:** the async thunks `fetchCart`, `mergeGuestCart`,
`addCartItem`, `updateCartItem`, `updateCartItemMeasurements`,
`removeCartItem`; the sync action `clearServerCart`; the reducer
(default export). Imported by `view/Cart.tsx` and by `App.tsx`
(`fetchCart`, for session bootstrap) — and, per its own inline comment,
by `components/Register.tsx`/`components/Authorization.tsx` for
`mergeGuestCart`+`fetchCart` after login (see [[P1-13]] in the fixes
history — **unverified** by direct read of those files in this pass,
inferred from the P1-13 docs entry and this slice's own design).

**How it works:**
- **`postCartItem(payload)`** (private helper, not exported): builds the
  request body for `POST /products/cart/items/` by hand — always sends
  `product_size_id`, a quantity clamped to at least 1
  (`clampMin1`/`toSafeInt`, which coerces non-numeric input to a
  fallback of 1 rather than throwing), `custom_length_selected` coerced
  to a strict boolean, and the seven measurement fields each defaulted to
  `""` if absent. It deliberately does **not** send `custom_length_cm` or
  `custom_length_surcharge` — a two-line comment right above the function
  explains why: `CartItemSerializer` (`tresse_backend/products/serializers.py`)
  declares both `read_only=True` and computes them server-side from the
  product (`validate()` sets `validated_data["custom_length_cm"] =
  product.custom_length_cm`), so a client-supplied value would just be
  ignored — this used to be flagged as a data-loss bug (the audit's
  P0-03) until reading the serializer showed it wasn't one; see the
  fixes documentation for the full reasoning. It also does **not** retry
  under a different field name on a 400 — an older version did (posting
  `product_size` instead of `product_size_id` as a fallback), which
  masked genuine stock-availability 400s from `CartItemAPIView`/
  `CartItemSerializer` behind a second, malformed request; that fallback
  was removed (audit P1-11) and the single request's error is now
  surfaced as-is.
- **`fetchCart`**: returns `null` immediately, with no request, if
  `hasToken()` is false (no point calling `GET /products/cart/`
  unauthenticated). Backend: `CartAPIView.get` — `get_or_create`s a
  `Cart` for `request.user`, then re-fetches it with `select_related`/
  `prefetch_related` for the item/product/size/image/category/collection
  chain, serialized by `CartSerializer`.
- **`mergeGuestCart`**: a `createAsyncThunk` typed against `RootState`
  (needs `getState` to read the guest cart). No-ops if there's no token
  or the guest cart (`selectGuestCartItems(getState())`, from
  `utils/cartSlice.ts`) is empty. Otherwise, maps every guest line to a
  `postCartItem(...)` call *and*, inside that same `.map` callback right
  after the `await`, dispatches `removeGuestCartLine({lineId: it.lineId})`
  — so each line is removed from the guest cart the moment its own
  request resolves, not after every line has settled. All requests run
  concurrently via `Promise.allSettled`; the code just logs a
  `console.warn` on any rejection rather than surfacing it to the UI — a
  failed line simply stays in the guest cart for the next login/merge
  attempt.
- **`addCartItem`**: thin wrapper over `postCartItem`.
- **`updateCartItem`**: `PUT /products/cart/items/<item_id>/` with only
  `{quantity: clampMin1(quantity)}`. Backend: `CartItemAPIView.put`,
  which loads the item, copies `request.data`, force-sets
  `product_size_id` back onto the payload (so a client can't change which
  product/size a cart line points to via this endpoint even if it tried),
  and validates via `CartItemSerializer(item, data=payload,
  partial=True, ...)` — `partial=True` is what makes a quantity-only or
  measurements-only body safe to send without clobbering the other
  fields.
- **`updateCartItemMeasurements`**: same endpoint, PUT with just the
  measurement fields (no `quantity`) — safe for the same `partial=True`
  reason above.
- **`removeCartItem`**: `DELETE /products/cart/items/<item_id>/`, then
  returns the `item_id` so the reducer can filter it out of local state
  without waiting for a re-fetch.
- **Reducers:** `fetchCart` replaces `state.cart` wholesale on success.
  `addCartItem`/`updateCartItem`/`updateCartItemMeasurements` all use the
  same pattern — find the item by `id` in `state.cart.items`, replace it
  in place if found, otherwise (only in `addCartItem`) push it. All three
  are no-ops if `state.cart` is `null` (e.g. a request resolved after the
  user logged out).
- **`clearServerCart`**: keeps the cart "shell" (`{...state.cart, items:
  []}`) rather than nulling the whole cart — **unverified** exactly why
  the shell (other `Cart` fields, if any beyond `items`) is worth
  preserving versus just setting `cart: null`; no comment explains the
  choice, and it's only called from a test in this read-through, not
  from application code — **unverified** whether any component actually
  dispatches it.

**What it talks to:** `api/axiosInstance.ts`, `types/token.ts`
(`getAccessToken`, to gate every thunk), `types/cart.ts` (`CartDto`,
`CartItemDto`), `utils/cartSlice.ts` (`removeFromCart` aliased as
`removeGuestCartLine`, and `selectGuestCartItems`) — this is the one
place `store/` and `utils/`'s cart slices talk to each other directly.
Backend endpoints: `GET /products/cart/`, `POST /products/cart/items/`,
`PUT /products/cart/items/<id>/`, `DELETE /products/cart/items/<id>/`
(all `products/views.py`: `CartAPIView`, `CartItemAPIView`).

**Watch out for:**
- `mergeGuestCart`'s per-line removal (dispatched *inside* the `.map`
  callback, right after that line's own `await postCartItem(...)`) is
  the deliberate fix for a real, tested bug: clearing the whole guest
  cart only after every request settled meant a partial failure kept
  *already-transferred* lines in the guest cart too, and the next login
  reposted them — `CartItemAPIView` adds the incoming quantity onto the
  existing server line rather than rejecting a duplicate, so the
  customer ended up with double the quantity. `serverCartSlice.test.ts`
  pins this exactly: "removes only the succeeded line after a partial
  failure, leaving the failed line for the next attempt."
- The `addCartItem`/`updateCartItem`/`updateCartItemMeasurements`
  reducers all silently no-op when `state.cart` is `null` — there's no
  error surfaced to the user in that case; it relies on the UI not being
  able to dispatch these thunks without a loaded cart in the first place.
- `postCartItem` is not exported — only reachable through `addCartItem`
  and `mergeGuestCart`, which keeps the "one request, no retry-with-
  different-field-name" contract from being bypassed by a new call site
  that reimplements the POST by hand.

**Interview questions:**
- *Q: Why does `postCartItem` never send `custom_length_cm` or
  `custom_length_surcharge`?* — Because `CartItemSerializer` on the
  backend marks both `read_only=True` and computes them itself from
  `product.custom_length_cm`/`product.custom_length_surcharge` in
  `validate()` — anything the client sent for those two fields would be
  discarded, so sending them is pure dead weight, not a bug.
- *Q: Walk through what happens if a guest has three items and the
  second one's merge request fails with a 500.* — All three `POST
  /products/cart/items/` calls fire concurrently. The first and third
  resolve and are immediately removed from the guest cart via
  `removeGuestCartLine`. The second's promise rejects; nothing removes
  its guest-cart line, so it stays there, and a `console.warn` logs the
  `Promise.allSettled` results. On the next login attempt,
  `mergeGuestCart` runs again and only posts that one remaining line.
- *Q: Why is `partial=True` on the backend `PUT` important for
  `updateCartItem` and `updateCartItemMeasurements` to both be safe
  calling the same endpoint?* — Without it, DRF's serializer would
  require every non-optional field on every `PUT`, so a quantity-only
  body would either fail validation or (worse, if fields had defaults)
  silently reset the measurement fields to their defaults; `partial=True`
  makes each call touch only the keys it actually sent.
- **Harder follow-up:** *Q: `mergeGuestCart` calls
  `dispatch(removeGuestCartLine(...))` from inside an async thunk that's
  itself being awaited by `Promise.allSettled`. Is there a race between
  that dispatch and Redux Toolkit's own handling of this thunk's
  pending/fulfilled actions?* — No: `dispatch` here is a plain
  synchronous call into the store (Redux dispatches are synchronous even
  inside an async function), and it's dispatching a *different* slice's
  action (`cart`'s `removeFromCart`, i.e. `removeGuestCartLine`) than the
  one `mergeGuestCart` itself belongs to (`serverCart`). There's no
  shared state being mutated across the two — `mergeGuestCart` doesn't
  touch `state.serverCart.cart` at all (it doesn't even add the item to
  `serverCart` locally; that only happens on the next `fetchCart()` the
  caller is expected to trigger, per the P1-13 fix wrapping both
  `mergeGuestCart()` and `fetchCart()` around registration/login).

---

### `src/store/serverCartSlice.test.ts`

**What it mocks:** `../api/axiosInstance` (all four HTTP methods) and
`../types/token`'s `getAccessToken`, both fully mocked — no real network,
no real `localStorage` read for the token check.

**What it asserts, by `describe` block:**
- **reducer**: initial state shape; `clearServerCart` empties `items`
  but keeps the cart object when one exists, and is a no-op on a `null`
  cart.
- **`fetchCart`**: skips the request entirely with no token; stores the
  response on success; sets `error` (as a string) on rejection.
- **`addCartItem`**: sends the expected body with quantity clamped to
  `1`; does **not** retry on a 400 and surfaces the rejection as-is
  (pins the removal of the old retry-with-`product_size`-fallback
  behavior — audit P1-11); does not retry on other error codes either;
  replaces an existing item by `id` instead of duplicating it in state.
- **`updateCartItem`** / **`updateCartItemMeasurements`**: quantity
  clamping; the measurements call's body has no `item_id` key (it's
  destructured out before the request); state updates by matching `id`.
- **`removeCartItem`**: filters the removed id out of `items`.
- **`mergeGuestCart`**: no request with no token or an empty guest cart;
  all lines post and the guest cart ends up empty when every request
  succeeds; **the three tests that exist specifically because a real bug
  was found here** — a partial failure leaves only the failed line in the
  guest cart, a second merge attempt posts only that remaining line, and
  the custom-length flag (but not the read-only cm/surcharge fields) is
  forwarded on merge.

**Interview question:** *Q: Why does the test file combine the reducers
with `combineReducers` before passing them to `configureStore`, instead
of passing the `{auth, serverCart, wishlist, cart}` map directly the way
`store/index.ts` does?* — A comment in the test explains it: passing an
inline reducer map together with an untyped `preloadedState` makes
TypeScript infer the `reducer` option's required shape too narrowly
(`Reducer<S>` instead of a `ReducersMapObject`), which surfaces as a
`TS2353` "unknown property" error on the first key of the literal;
pre-combining sidesteps the inference issue.

---

### `src/store/wishListSlice.ts`

**What it is:** Just the wishlist **count** (a number for the header
badge), not the wishlist's contents — the actual wishlist items are
fetched separately by `view/WishList.tsx` directly (**unverified** by
direct read of that file's data-fetching in this pass; inferred from
this slice only ever handling a `count`).

**Why it exists:** The header needs a live wishlist count on every page,
not just the wishlist page itself, so it has to be global Redux state
rather than local to one view.

**What it exports:** the thunk `fetchWishlistCount`; the sync actions
`setCount`, `inc`, `dec`, `clearError`; the reducer (default export).
`setCount` is imported directly by `main.tsx` (see the Entry point
section) and, per `App.tsx`'s import, dispatched from there too on
logout-driven `setOnUnauthorized`.

**How it works:** `fetchWishlistCount` → `GET /products/wishlist/count/`,
returning `res.data.count` on success or a typed `rejectValue` string on
failure (via `rejectWithValue`, not a thrown error — lets the reducer's
`.rejected` case read `action.payload` directly instead of parsing
`action.error`). `inc`/`dec` are explicitly documented in their own
inline comments as **optimistic UI helpers** — increment/decrement the
badge immediately on a user action, before the server confirms — with a
warning that they should only be used alongside either a rollback or a
re-sync via `fetchWishlistCount`. `setCount` is the "source of truth"
setter, clamped to never go negative (`Math.max(0, ...)`), meant to be
called after a real server response.

**What it talks to:** `api/axiosInstance.ts`. Backend: `GET
/products/wishlist/count/`, served by `WishlistViewSet.count`
(`products/views.py`), a custom `@action` on the `wishlist/`
router-registered viewset (`products/urls.py`).

**Watch out for:** The `.rejected` case's own trailing comment says the
quiet part out loud: "if your app triggers `fetchWishlistCount` on
logout, the count will reset anyway via `setCount(0)`" — but per the
`main.tsx`/`App.tsx` "Watch out for" notes above, `App.tsx`'s
unauthorized handler does **not** call `setCount(0)` (only `main.tsx`'s
does, and that registration is overwritten). So on a forced logout via a
401, this comment's assumption doesn't hold in the current code — the
count can keep showing its last fetched value until something else
re-triggers `fetchWishlistCount` and it resolves to a fresh (likely `0`
or error) value. This is the direct consequence of the P2-03 audit
finding described in the `main.tsx` section, observed here from the
slice's own side.

**Interview questions:**
- *Q: Why does `fetchWishlistCount` use `rejectWithValue` instead of just
  letting the thunk throw?* — So the `.rejected` reducer case can read a
  known, typed `action.payload` (`"Failed to fetch wishlist count"`)
  instead of having to parse whatever shape `action.error.message` (a
  generic serialized error) happens to have — safer to read in the
  reducer regardless of what kind of error Axios actually threw.
- *Q: What's the difference between `inc`/`dec` and `setCount`, and when
  would each be used?* — `inc`/`dec` are for optimistic, instant UI
  feedback on a single add/remove action, before the server confirms;
  `setCount` is meant to follow an authoritative server response (the
  count endpoint itself, or a mutation response that includes a fresh
  count) and clamps to zero so a race between a `dec` and a stale
  `fetchWishlistCount` response can't show a negative badge.

---

## `utils/`

A grab-bag folder in the literal sense — general-purpose Redux slices
that don't talk to the server (`authSlice.ts`, `cartSlice.ts`), small
pure helpers (`hooks.ts`, `images.ts`, `routing.ts`), one API-calling
helper that doesn't fit `api/` (`newsletter.ts`), the marketing-pixel
system (`metaPixel.ts`, `tiktokPixel.ts`, `pixelLoader.ts`), a route
guard (`PrivateRoute.tsx`), and — critically — a second, unused
`axiosInstance.ts` and an unused `store.ts` duplicating `types/token.ts`.
Nothing here talks to the backend except `newsletter.ts` and the dead
`axiosInstance.ts`; everything else is client-only logic or local state.

### `src/utils/authSlice.ts`

**What it is:** The logged-in-user Redux slice — `{token, user,
isLoggedIn}` — and the only place that decides whether a `{token, user}`
pair from a login/register response, or from `localStorage` on page
load, is trustworthy enough to log the user in.

**Why it exists:** Every page needs to know "is someone logged in, and
who" without re-deriving it from raw `localStorage` reads scattered
everywhere.

**What it exports:** the actions `setCredentials`, `logout`; the reducer
(default export). Imported by `App.tsx` (session bootstrap, and via the
unauthorized handler's `logout()`), and by every auth-flow component
(`Authorization.tsx`, `Register.tsx`, presumably `PasswordChange.tsx`
et al. — **unverified** exhaustively in this pass; confirmed for
`App.tsx` by direct read).

**How it works:**
- **Initial state is computed at module load**, not inside the slice's
  `initialState` object lazily — `getAccessToken()` and
  `readStoredUser()` both run as soon as this module is imported, so the
  store starts already "logged in" if a valid token+user pair exists in
  `localStorage`. This runs *before* `App.tsx`'s own bootstrap effect
  fires — the two are redundant with each other for the normal case, but
  `App.tsx`'s effect is still what calls `fetchCart`/`fetchWishlistCount`
  for that already-restored session.
- **`normalizeUser(input)`**: requires a positive integer `id` (coerced
  from a string if needed) and an `email` containing `"@"` (trimmed,
  lowercased); accepts **either** `first_name`/`last_name` (snake_case,
  what the backend actually sends — see `CustomTokenObtainPairSerializer`
  in `tresse_backend/accounts/serializers.py`) **or** `firstName`/
  `lastName` (camelCase) as a fallback for whichever key is present.
  Anything that fails validation makes the whole payload rejected — no
  partial user.
- **`setCredentials({token, user, refresh})`**: if `normalizeUser(user)`
  fails or `token` trims to empty, it does a **hard reset** — clears
  Redux state to logged-out *and* calls `clearAuthStorage()` — rather
  than leaving stale state around. On success: sets Redux state, persists
  the token via `setAccessToken` (delegated to `types/token.ts`,
  described in its own section as "single source of truth"), persists
  the refresh token via `setRefreshToken` if one was passed — or
  explicitly calls `removeRefreshToken()` if not, so a login response
  without rotation can't leave a stale refresh token from a previous
  session — writes the normalized user object to `localStorage` itself
  (not delegated to `types/token.ts`, per this file's own comment: "we
  keep user parsing here because it's UI/Redux state related, but all
  token storage is delegated to token utils"), and removes two legacy
  keys (`"token"`, `"access_token"`) left over from an earlier storage
  scheme.
- **`logout()`**: resets Redux state and calls `clearAuthStorage()`.

**What it talks to:** `types/token.ts` (`clearAuthStorage`,
`getAccessToken`, `removeRefreshToken`, `setAccessToken`,
`setRefreshToken`, `AUTH_STORAGE_KEYS`), `localStorage` directly (only
for the `USER_KEY` read/write), `types/user.ts` (`User`), `types/auth.ts`
(`AuthState`).

**Watch out for:**
- This file imports from `../types/token` — the version with the
  `isBrowser` guards, `try/catch`, and the fuller API surface — **not**
  the near-duplicate `utils/store.ts` (see below), which happens to
  implement the same functions with no guards at all. Two modules
  offering the same four function names in this codebase is a real trap
  for a wrong import.
- The module-level `getAccessToken()`/`readStoredUser()` calls at import
  time mean this slice's `initialState` is **not** pure/deterministic in
  the usual Redux sense — it depends on ambient `localStorage` state at
  the moment the module is first imported, which matters for tests (see
  below) and for server-side rendering, if that were ever added
  (**unverified** whether SSR is in scope for this project at all).

**Interview questions:**
- *Q: Why does `setCredentials` explicitly call `removeRefreshToken()`
  when no `refresh` is passed, instead of just leaving whatever refresh
  token is already stored?* — So logging in with a response that doesn't
  include a refresh token can't accidentally leave a *different* (older,
  possibly another account's) refresh token active — the storage should
  reflect exactly what the current login response said, not silently
  inherit leftover state.
- *Q: Why accept both `first_name` and `firstName` in `normalizeUser`?*
  — The real backend response uses snake_case
  (`CustomTokenObtainPairSerializer`'s `user` object), but the fallback
  exists for defensive compatibility with any other shape — a test
  (`authSlice.test.ts`, "accepts camelCase firstName/lastName as
  fallback") pins this explicitly, though **unverified** which actual
  caller relies on the camelCase branch rather than it being pure
  defensive coding.
- **Harder follow-up:** *Q: This slice computes its `initialState` at
  module import time by reading `localStorage`. What does that mean for
  writing a test that wants to start from a clean, logged-out state?* —
  A: `authSlice.test.ts` handles it by mocking `../types/token` entirely
  (`getAccessToken: vi.fn(() => null)`), so the module-level calls at
  import time see no token and no stored user regardless of what's
  actually in the test runner's `localStorage`; every test then calls
  `reducer(loggedOutState(), someAction())` directly against a hand-built
  state object rather than relying on the module's own `initialState` at
  all — sidestepping the import-time computation rather than trying to
  reset it between tests.

---

### `src/utils/cartSlice.ts`

**What it is:** The **guest** cart — everything before login, backed by
`localStorage` under the key `"guest_cart"`. See `store/index.ts`'s
"Watch out for" on the naming split between this and `serverCartSlice.ts`.

**Why it exists:** A visitor who hasn't logged in still needs to build a
cart, and it has to survive a page reload without any server round-trip.

**What it exports:** types `CustomMeasurements`, `CustomLengthFields`,
`GuestCartItem` (= `Product & CustomMeasurements & CustomLengthFields &
{lineId, quantity, product_size_id, sizeName?, maxQty?}`),
`ClientCartItem` (a plain alias of `GuestCartItem`), `GuestCartState`;
actions `addToCart`, `removeFromCart`, `updateQuantity`,
`updateCustomMeasurements`, `clearCart`, `setItemMaxQty`; the reducer
(default export); selectors `selectGuestCartItems`,
`selectGuestCartCount`, `selectGuestCartTotal`. Imported by
`view/Cart.tsx` (guest-cart display/editing), `store/serverCartSlice.ts`
(`removeFromCart` aliased as `removeGuestCartLine`,
`selectGuestCartItems`, for the merge-on-login flow), and presumably
wherever "Add to Cart" is clicked pre-login (`view/ProductDetails.tsx`,
`view/ProductCatalog.tsx` — **unverified** by direct read of those files
in this pass).

**How it works:**
- **Line identity is `lineId`, not `id + product_size_id`.** Every line
  gets a stable `lineId` (`crypto.randomUUID()`, with a manual
  `line_<timestamp>_<random>` fallback for environments without
  `crypto.randomUUID`) at creation, and `removeFromCart`,
  `updateQuantity`, `updateCustomMeasurements`, and `setItemMaxQty` all
  look a line up **by `lineId` alone**. This is deliberate and explained
  by an inline comment: two lines can share the same `id` (product) and
  `product_size_id` (size) but differ in custom measurements or custom
  length — a customer ordering the same sweater twice with different
  measurements — and addressing by `id`+`product_size_id` used to match
  *both* lines at once (audit P1-10), so `removeFromCart` on one line
  deleted both, and `updateQuantity`/`updateCustomMeasurements` silently
  acted on whichever matching line `Array.prototype.find` happened to
  return first.
- **`addToCart`'s matching logic**, used only to decide whether to
  *increment* an existing line vs. push a new one: `item.id ===
  product.id && item.product_size_id === product_size_id &&
  sameMeasurements(...) && sameCustomLength(...)`. `sameMeasurements`
  compares all seven measurement fields with `?? ""` defaults;
  `sameCustomLength` first compares the `custom_length_selected` boolean,
  and only compares `custom_length_cm`/`custom_length_surcharge` (via
  `toMoney`, which coerces to a number and falls back to `0`) if both
  sides have it selected — so two *unselected* lines always count as
  "same length" regardless of leftover cm/surcharge values.
- **`maxQty` handling:** `resolveMaxQty(existingMax, incomingMax)`
  prefers whatever `maxQty` the line *already* has over a newly-passed
  one — so once a line has a known stock ceiling, a later `addToCart`
  call that doesn't pass `maxQty` can't accidentally clear it. Every
  quantity change (`addToCart` increment, `updateQuantity`,
  `setItemMaxQty` itself) runs through `clampToMax`, which floors at `1`
  and caps at `maxQty` if one is set.
- **`loadFromLS()` / backfill on load:** parses `localStorage["guest_cart"]`,
  validates it's an object with an `items` array (anything else, or a
  parse error, is silently treated as "no stored cart" — `initialState`
  falls back to `{items: []}`), then calls `backfillLineIds(state)` —
  which assigns a fresh `lineId` to any stored line that predates this
  field (i.e. was saved before the `lineId` change shipped) — and, if
  anything was backfilled, immediately persists the backfilled state back
  to `localStorage` so the fix is durable, not just in-memory for this
  session.
- Every reducer that mutates `state.items` calls `saveToLS(state)` at the
  end, so the guest cart is always synced back to `localStorage`
  immediately after each action (no debouncing, no batching).
- **`selectGuestCartTotal`**: `price * quantity`, plus
  `custom_length_surcharge * quantity` **only** when
  `custom_length_selected === true` on that line — a `createSelector`
  memoized selector, so it doesn't re-sum on every render unless
  `items` actually changed.

**What it talks to:** `localStorage` (key `"guest_cart"`), `types/product.ts`
(`Product`), `crypto.randomUUID()` (browser API, with a fallback).

**Watch out for:**
- `sameCustomLength`'s short-circuit — two lines with
  `custom_length_selected: false` are always "the same length" even if
  one somehow has a leftover non-zero `custom_length_cm` — is
  intentional: `addToCart` always writes `custom_length_cm: null,
  custom_length_surcharge: 0` when `custom_length_selected` is falsy (see
  the object literal it pushes), so in practice this branch never
  actually encounters divergent leftover values from this reducer alone,
  but the guard exists in case a line loaded from an older
  `localStorage` shape somehow has one.
- `selectGuestCartCount`/`selectGuestCartTotal` are plain functions
  wrapped in `createSelector([selectGuestCartItems], ...)` — they only
  memoize correctly against a store shaped like `{cart: GuestCartState}`
  (the type `HasGuestCart` constrains the selector's input, but nothing
  stops a caller from passing an unrelated object shape at the type
  level if it happens to structurally match).
- `GuestCartItem = Product & ...` spreads the **entire** `Product` object
  into every cart line (`state.items.push({...product, ...})` in
  `addToCart`) — every field the catalog API returns for that product
  (description, images, category, etc.) gets duplicated into
  `localStorage` per line, which is what audit item P2-10 describes as
  bloating `localStorage` and freezing the price at add-time (a later
  price change on the backend isn't reflected in an already-added guest
  line until checkout re-validates server-side — **unverified** whether
  checkout does re-validate the price, would need to read the checkout
  flow).

**Interview questions:**
- *Q: Why identify cart lines by a generated `lineId` instead of some
  combination of the product's own fields?* — Because the combination
  that's unique to a *product variant* (`id` + `product_size_id`) isn't
  unique to a cart *line* — a customer can legitimately have two lines
  for the same product and size with different custom measurements, and
  any composite key built from product/size fields collides for exactly
  that case (the bug `lineId` was introduced to fix).
- *Q: Why does `backfillLineIds` immediately persist to `localStorage`
  after assigning missing `lineId`s, instead of doing it lazily on the
  next mutation?* — So a cart saved before this change is durably
  migrated the moment it's loaded — if it only backfilled in memory,
  closing the tab without triggering any other cart mutation would lose
  the backfill and the same items would need re-backfilling (with
  different random ids) on the next load, which is harmless but
  wasteful, and briefly leaves the persisted copy without `lineId`s that
  the in-memory copy has.
- *Q: What would happen if `sameCustomLength` compared
  `custom_length_cm`/`custom_length_surcharge` with `===` instead of
  going through `toMoney` first?* — A stored value of the string `"15"`
  (e.g. from JSON round-tripping a value that started as a number but
  got coerced somewhere) would compare unequal to the number `15`,
  splitting what should be one line into two — `toMoney` exists
  specifically to make that comparison numeric-safe regardless of the
  stored type.
- **Harder follow-up:** *Q: This slice computes its `initialState` from
  `localStorage` at module import time, the same pattern as
  `authSlice.ts`. Is that a coincidence, and does it cause the same kind
  of testing complication?* — A: Not a coincidence — both slices need to
  restore persisted client state synchronously before the first render
  (there's no async "hydration" step in this app), so both read
  `localStorage` eagerly at module scope rather than in a thunk. It
  causes a milder version of the same testing wrinkle:
  `cartSlice.test.ts` doesn't mock `localStorage` away the way
  `authSlice.test.ts` mocks `types/token`, but its "loading a cart saved
  before `lineId` existed" tests explicitly call `vi.resetModules()`
  before `localStorage.setItem(...)` and a fresh `await import("./cartSlice")`
  — because otherwise the already-imported module's `initialState` was
  computed once, earlier, and reimporting the same module without
  resetting it would return the cached module rather than re-running the
  top-level `loadFromLS()` call against the newly-set storage.

---

### `src/utils/authSlice.test.ts`

**What it mocks:** `../types/token` entirely — every exported function
becomes a `vi.fn()`, with `getAccessToken` defaulting to `() => null` so
the slice's module-level `initialState` computation sees a clean,
logged-out environment regardless of the test runner's actual
`localStorage`.

**What it asserts:** `setCredentials` — logs in with a valid
token+user; trims/lowercases the email; accepts camelCase
`firstName`/`lastName` as a fallback; calls `setAccessToken` with the
*trimmed* token; calls `setRefreshToken` when a refresh token is passed
and `removeRefreshToken` when it isn't (never both); does a full reset
(`isLoggedIn: false`, `token: null`, `user: null`, plus
`clearAuthStorage()` called) when the user is missing an `id` or has an
email without `"@"`, or when the token is empty/whitespace-only; does
**not** call `setAccessToken` at all when the payload is invalid.
`logout` — resets state and calls `clearAuthStorage()`.

**Interview question:** *Q: Why does this test file mock `types/token`
completely rather than letting the real module run against
`jsdom`'s `localStorage`?* — Two reasons visible from the file itself:
it isolates the assertions to "did `authSlice` call the right token
function with the right argument" rather than also exercising
`types/token.ts`'s own storage logic (that module has its own
responsibility to test separately), and it neutralizes the module-load-time
`getAccessToken()` call in `authSlice.ts` so every test's `initialState`
is predictable regardless of `localStorage`'s real state at import time.

---

### `src/utils/cartSlice.test.ts`

**What it mocks:** Nothing via `vi.mock` — this suite runs against the
real reducer and real `localStorage` (`jsdom`'s implementation),
clearing it in `beforeEach`.

**What it asserts:** `addToCart` — a new item starts at quantity 1 with
a generated `lineId`; adding the identical product+size+measurements+length
again increments quantity instead of duplicating; a different
`product_size_id`, different measurements, or a different custom-length
selection each produce a **separate** line; identical custom length
cm/surcharge **merge** instead of duplicating; `maxQty` is enforced on
increment and the *first known* `maxQty` survives a later add that omits
it; every add persists to `localStorage`. `removeFromCart` /
`updateQuantity` / `updateCustomMeasurements` — each has a test titled
around "leaves the other untouched" for two lines sharing a product+size
with different measurements, which is exactly the audit P1-10 regression
this file exists to pin: acting on one `lineId` must not touch the
sibling line. `clearCart`, `setItemMaxQty` (including that a `0` or
negative `maxQty` is ignored rather than applied). A dedicated
`describe("loading a cart saved before lineId existed")` block covers
the backfill migration path end-to-end, using `vi.resetModules()` +
dynamic `import()` to force the module to re-read a hand-seeded
`localStorage` value. `selectors` — count sums quantities, total applies
the surcharge only when `custom_length_selected` is true.

**Interview question:** *Q: Which three tests in this file exist purely
because a real bug was found, rather than as general coverage?* — The
three "...leaves the other untouched" tests under `removeFromCart`,
`updateQuantity`, and `updateCustomMeasurements` — each one is the
direct regression test for audit item P1-10 (two lines for the same
product+size colliding on `id + product_size_id`), written to fail
against the pre-`lineId` code and pass against the fix.

---

### `src/utils/PrivateRoute.tsx`

**What it is:** The route guard used for every path in `App.tsx`'s
route table that requires login (`/dashboard`,
`/account/change-password`, `/orders`, `/order`, `/wishlist`).

**Why it exists:** Centralizes "redirect to login, remembering where I
was going" instead of every protected page implementing that check
itself.

**What it exports:** `export default function PrivateRoute({children})`.

**How it works:** Reads `isLoggedIn` from `state.auth.isLoggedIn` via
`useAppSelector`. If true, renders `children` as-is. If false, builds
`next` from the current `location` (`pathname + search + hash`),
validates it with `isSafePath` (from `utils/routing.ts`) — falling back
to `"/"` if it's not a safe same-origin path — and renders `<Navigate
to={"/login-choice?next=" + encodeURIComponent(next)} replace />`.
`replace` (not a push) means the protected route the user tried to visit
doesn't stay in browser history as a dead entry.

**What it talks to:** `utils/hooks.ts` (`useAppSelector`),
`utils/routing.ts` (`isSafePath`), `react-router-dom` (`Navigate`,
`useLocation`).

**Watch out for:** This is the *third* place in the app with
open-redirect-guard logic for a `next` param — `App.tsx`'s unauthorized
handler has its own inline `isSafeNextPath`, and this file uses
`utils/routing.ts`'s `isSafePath` — two differently-named functions
doing the same check (`startsWith("/") && !startsWith("//")`),
implemented independently rather than one shared utility both call.

**Interview question:** *Q: Why `replace` instead of a normal navigate
when redirecting to `/login-choice`?* — So pressing the browser's Back
button after logging in doesn't return the user to the protected URL
they were bounced from (which would just bounce them again) — `replace`
overwrites that history entry instead of adding a new one on top of it.

---

### `src/utils/hooks.ts`

**What it is:** The two-line typed-Redux-hooks boilerplate every Redux
Toolkit + TypeScript project needs.

**Why it exists:** `useSelector`/`useDispatch` from `react-redux` are
generic and untyped against this app's specific state shape by default;
wrapping them once here means every component gets full autocomplete and
type-checking on `state` and `dispatch` without importing `RootState`/
`AppDispatch` and re-typing the hook at every call site.

**What it exports:** `useAppDispatch` (returns `useDispatch<AppDispatch>()`),
`useAppSelector` (`TypedUseSelectorHook<RootState>`). Imported throughout
`components/`, `view/`, and `utils/PrivateRoute.tsx`.

**Interview question:** *Q: What breaks if a component uses the plain
`useSelector` from `react-redux` instead of `useAppSelector` from this
file?* — Nothing breaks at runtime — it still works — but the selector
callback's `state` parameter is typed `unknown`/`any` rather than
`RootState`, so a typo in a state path (e.g. `state.serverCrat`) wouldn't
be caught by TypeScript, only surfacing as `undefined` at runtime.

---

### `src/utils/images.ts`

**What it is:** One function, `toHttps`.

**Why it exists:** Normalizes an image URL to `https://` regardless of
how it was stored — handles a bare `http://` URL (rewritten to
`https://`), a protocol-relative URL (`//host/path`, prefixed with
`https:`), an already-`https://` URL (returned as-is), and anything else
(returned unchanged, on the assumption it's a relative path). Returns
`undefined` for `null`/`undefined`/empty input rather than an empty
string, so a caller can use it directly in a conditional (`src={toHttps(url)}`
without rendering a broken empty `src`).

**What it exports:** `toHttps`. **Unverified** which specific views call
it in this pass — likely anywhere a product/media image URL from the
backend (potentially Cloudinary, potentially local media) is rendered.

**Interview question:** *Q: Why bother rewriting `http://` to
`https://` on the client instead of just always storing/serving `https://`
URLs from the backend?* — Defense against a mixed-content browser
warning/block if any stored or third-party URL happens to be `http://`
— cheap to normalize once at the point of use rather than relying on
every producer of an image URL to have gotten it right.

---

### `src/utils/newsletter.ts`

**What it is:** The newsletter subscribe flow's client logic — validation,
cooldown/visibility rules for the subscribe modal, the actual POST, and a
fairly elaborate error-message extraction strategy.

**Why it exists:** Three different UI entry points (a modal, the footer,
and — per its own `SubscribeSource` union including `"unsubscribe"` — the
resubscribe button on the unsubscribe confirmation page) all need the
same subscribe behavior and the same "don't nag someone who already
subscribed or just dismissed the modal" rules, so it's centralized rather
than duplicated per call site.

**What it exports:** `SubscribeSource` (`"modal" | "footer" |
"unsubscribe" | "unknown"`), `isValidEmail`, `markNewsletterDismissed`,
`markNewsletterSubscribed`, `canShowNewsletterModal(isLoggedIn)`,
`subscribeNewsletter(email, source)`. Imported by `view/Home.tsx` (the
newsletter modal — **unverified** by direct read in this pass),
`view/Footer.tsx` (**unverified**), and `view/NewsletterUnsubscribe.tsx`
(confirmed by the fixes documentation's description of the resubscribe
button reusing this helper).

**How it works:**
- **`canShowNewsletterModal(isLoggedIn)`**: returns `false` outright for
  a logged-in user (the modal is guest-only by design). Otherwise checks
  two independent cooldowns read from `localStorage` timestamps:
  `SUBSCRIBED_COOLDOWN_DAYS` (365 days since `markNewsletterSubscribed()`
  was last called — don't ask someone who already subscribed a year ago
  again until the cooldown passes) and `DISMISS_COOLDOWN_DAYS` (14 days
  since `markNewsletterDismissed()` — don't re-nag someone who closed the
  modal recently). Both must have passed (or never been set) for the
  modal to be eligible to show.
- **`subscribeNewsletter(email, source)`**: client-side `isValidEmail`
  check first (a regex plus a 3–254 length bound) — throws immediately,
  no request, if it fails. Otherwise `POST /newsletter/subscribe/` with
  `{email: clean, source}` and a `12_000`ms timeout, and on success calls
  `markNewsletterSubscribed()`. Backend: `SubscribeAPIView`
  (`tresse_backend/newsletter/views.py`), `AllowAny`, throttled by
  `NewsletterAnonThrottle` (scope `newsletter_anon`) — the throttling and
  the "only email on `created` or reactivation" guard were added per the
  fixes documentation (P0-05); the `source` field the client sends
  presumably feeds the backend's own attribution tracking
  (**unverified** by direct read of the serializer in this pass).
- **Error handling on failure**: first checks `isTimeoutError` (Axios's
  `ECONNABORTED` code, or a message containing "timeout") for a specific
  "server is taking too long" message. Otherwise tries
  `extractBestErrorMessage(data)` — DRF `detail` string, then
  `non_field_errors[0]`, then `email[0]` specifically (the field most
  likely to have a validation error for this form), then the first
  string-array value found under *any* key — and falls back to a
  status-code-keyed generic message (400/404/405/500+) if nothing in the
  body was usable, or a fully generic "Subscription failed" if there's no
  status at all.

**What it talks to:** `api/axiosInstance.ts` (imported here as
`axiosInstance`, the default export — same file, different local name
than most other callers use `api`), `localStorage` (two timestamp keys).

**Watch out for:** `extractBestErrorMessage` checks `email` specifically
before the generic per-key loop — meaning if a backend response somehow
included both an `email` error and, say, a `source` error, `email`'s
message always wins, matching what's most actionable for a subscribe
form's single input field. The 404/405 fallback messages
("Subscribe endpoint not found... contact support" / "...does not allow
this method") are unusually specific for a frontend error string — they
read like they were added while debugging a real routing issue during
development rather than being generic boilerplate.

**Interview questions:**
- *Q: Why does `canShowNewsletterModal` check two separate cooldowns
  instead of one "don't show again" flag?* — They answer different
  questions: the dismiss cooldown is "did they just say not now" (short,
  14 days — worth asking again relatively soon), while the subscribed
  cooldown is "are they already on the list" (long, 365 days — mostly a
  safety net in case `is_active` on the backend was toggled off and the
  modal would otherwise nag an actual subscriber).
- *Q: Why give `subscribeNewsletter` a 12-second timeout instead of
  relying on Axios's default (no timeout)?* — So a hung request (slow
  backend, dropped connection) resolves into a specific, actionable error
  message within a bounded time instead of leaving the UI's "submitting"
  state spinning indefinitely with no default Axios timeout to end it.

---

### `src/utils/routing.ts`

**What it is:** `isSafePath(p)` — a type-guarding safe-redirect check
(`p is string`), requiring the path to be non-empty, start with `/`, and
not start with `//`.

**Why it exists:** A `next=` redirect target taken from user-controlled
input (a query string or `location`) must be constrained to a same-origin,
relative path — otherwise it's an open-redirect vector. See `utils/PrivateRoute.tsx`'s
"Watch out for" — this exact check is duplicated (not shared) in
`App.tsx` as `isSafeNextPath`.

**What it exports:** `isSafePath`. Imported by `utils/PrivateRoute.tsx`.

**Interview question:** *Q: Why does `isSafePath` reject a path starting
with `//` specifically?* — Browsers interpret a URL starting with `//`
as protocol-relative — `//evil.com/x` resolves to
`https://evil.com/x` using the current page's protocol — so without this
check, an attacker-controlled `next` value shaped like that would redirect
off-site after what looks like an internal navigation.

---

### `src/utils/store.ts`

**What it is:** A near-exact duplicate of `types/token.ts` — the same
six function names (`getAccessToken`, `setAccessToken`,
`removeAccessToken`, `getRefreshToken`, `setRefreshToken`,
`removeRefreshToken`, `isAuthenticated`, `clearTokens`,
`clearAuthStorage`), reading/writing the same `localStorage` keys
(`"access"`, `"refresh"`, `"user"`), dispatching the same
`"tresse:authChanged"` custom event — but with **no** `isBrowser` guard
and **no** `try/catch` around any `localStorage` call, so it would throw
in an environment without `localStorage` (a test runner without `jsdom`,
a prerender step) where `types/token.ts` would silently no-op instead.

**Why it exists:** **Unverified** — no comment explains it, and a
repo-wide search (`grep -rln "utils/store" src`) finds **zero**
importers anywhere in the application or its tests. It's dead code,
matching audit item P3-04, which specifically calls out that its name
"collides confusingly with the Redux store in `store/index.ts`."

**What it exports:** The same function names `types/token.ts` exports,
listed above — but nothing imports this file, so none of them are
actually reachable from the running app.

**Watch out for:** If someone imports token helpers from `./store`
(relative to `utils/`) instead of `../types/token` — an easy mistake
given the name overlap with the real `store/` folder one level up — they
get the guard-less version, which will throw rather than gracefully
no-op if `localStorage` is unavailable in whatever environment runs that
code.

**Interview question:** *Q: If you were cleaning this codebase up, what
would you do with this file, and how would you confirm it's safe?* —
Delete it, after confirming with a repo-wide import search (as above)
that nothing references `utils/store` by any of its possible import
specifiers (`./store`, `../utils/store`, etc.) — which this file already
fails, since the search returns no matches.

---

### `src/utils/metaPixel.ts` and `src/utils/tiktokPixel.ts`

**What they are:** The two vendor-specific tracking-call wrappers —
`trackMeta(eventName, data)` and `trackTikTok(event, data)` — both
consent-gated versions of "call the vendor's pixel object if it exists."

**Why they exist:** Every call site that wants to fire a Meta or TikTok
event (`ProductDetails.tsx`, `ProductCatalog.tsx`, `Order.tsx`,
`OrderSuccess.tsx` — per the fixes documentation, **unverified**
exhaustively in this pass) needs the same consent check before firing,
so it lives here once instead of being repeated (and potentially
forgotten) at every call site.

**What they export:** `trackMeta` / `trackTikTok`. `tiktokPixel.ts` also
globally augments `Window` with an optional `ttq` shape (`track`, `page?`,
`revokeConsent?`, `load?`, plus the internal `_i`/`_t`/`_o`/`_q`/`methods`/
`setAndDefer` fields `pixelLoader.ts`'s stub needs).

**How they work:** Both check `getCookieConsent()?.marketing` first and
return immediately (no-op) if it's falsy — `getCookieConsent` comes from
`components/cookies/cookiePreferences.ts`. `trackMeta` then checks
`typeof window.fbq === "function"` before calling `fbq("track",
eventName, data)`; `trackTikTok` checks `typeof window === "undefined"`
(SSR/test safety) and `window.ttq?.track` before calling
`window.ttq.track(event, data)`.

**What they talk to:** `components/cookies/cookiePreferences.ts`
(`getCookieConsent`), `window.fbq` / `window.ttq` (populated by
`pixelLoader.ts`, if consent was ever granted this session).

**Watch out for:** Neither file loads the vendor script itself or checks
whether it's *actually finished loading* — they only check whether the
global function/object exists. Before `pixelLoader.ts`'s stub pattern
(see below), calling `trackMeta`/`trackTikTok` before the real script
loaded would have silently done nothing (`fbq`/`ttq` undefined); with the
stub in place, the call is queued by the stub and flushed once the real
script finishes loading — but that only works if `initMarketingPixels()`
already ran and consent was already granted, since these two files never
call `loadMetaPixel`/`loadTikTokPixel` themselves.

**Interview questions (one set, both files share the same pattern):**
- *Q: Why check cookie consent inside `trackMeta`/`trackTikTok`
  themselves, rather than only at the point where the pixel scripts are
  loaded?* — Because loading the script and firing an event are two
  separate moments — consent could be granted, the scripts loaded, and
  *then* revoked later in the same session; gating every individual
  tracking call (not just the initial load) is what actually guarantees
  no event fires after consent is withdrawn, matching what `pixelLoader.ts`'s
  revoke path handles on the loading side.
- *Q: What happens if `trackTikTok` is called in a test environment with
  no `window` at all?* — The explicit `typeof window === "undefined"`
  check returns early before touching `getCookieConsent()` or
  `window.ttq` — safe in Node/SSR-style environments; `trackMeta` has no
  equivalent guard and would throw if `window` itself didn't exist (only
  guarded against `window.fbq` not being a function, not against
  `window` itself being undefined) — **verified from the code**: this is
  an asymmetry between the two files.

---

### `src/utils/pixelLoader.ts`

**What it is:** The actual script-loading and consent-orchestration layer
for both marketing pixels — this is where `initMarketingPixels()` (called
once from `App.tsx`) lives.

**Why it exists:** [[P0-07]] — the pixel bootstrap snippets used to run
unconditionally in `index.html` on every page load, regardless of
consent. This file replaces that with a version that only ever injects
either vendor's script if `marketing` consent is already granted, and
reacts live to a consent change during the session (grant → load;
later revoke → tell the vendor SDKs to stop, without literally removing
the `<script>` tag).

**What it exports:** `initMarketingPixels()`. Imported by `App.tsx`
(called once in a `useEffect` with an empty dependency array).

**How it works:**
- **Module-level state:** `metaLoaded`, `tiktokLoaded`, `listenerAttached`
  — plain booleans, not Redux state, since this is one-time-per-page-load
  bookkeeping that no component needs to read.
- **`injectScript(src, id)`**: checks `document.getElementById(id)`
  first and no-ops if it already exists — the only guard against double
  injection at the DOM level (the `metaLoaded`/`tiktokLoaded` flags are
  the higher-level guard that stops this from even being called twice in
  the normal flow).
- **`ensureFbqStub()`**: if `window.fbq` isn't already a function, builds
  a minimal reimplementation of Meta's own bootstrap snippet — a callable
  stub that queues every call (`stub.queue.push(args)`) until the real
  `fbevents.js` finishes loading and replaces `callMethod`. This is
  necessary because `fbq("init", ...)` / `fbq("track", "PageView")` are
  called synchronously right after `injectScript`, before the actual
  script has had a chance to download and execute — without the stub,
  those calls would hit `undefined`.
- **`createTtqStub()`** does the equivalent for TikTok, replicating
  TikTok's own snippet: a fixed list of method names (`page`, `track`,
  `identify`, ..., `revokeConsent`, `grantConsent`) each turned into a
  queueing function via `setAndDefer`, plus a `load(id, options)` method
  that records init metadata (`_i`/`_t`/`_o`) and calls `injectScript`
  for TikTok's actual `events.js`.
- **`loadMetaPixel()`/`loadTikTokPixel()`**: each guarded by its own
  `*Loaded` flag plus `canUseDom()`; ensures the stub, injects the
  script, fires the pixel's init + first-pageview calls
  (`fbq("init", ...)` + `fbq("track", "PageView")`, or `ttq.load(...)` +
  `ttq.page()`), then flips the loaded flag.
- **`revokeMarketingConsent()`**: only calls
  `fbq("consent", "revoke")`/`ttq.revokeConsent()` if that vendor was
  actually loaded this session (`metaLoaded`/`tiktokLoaded` — calling
  revoke on a vendor that was never loaded would either no-op against an
  undefined stub or throw, so the flags gate it).
- **`applyConsent()`**: reads `getCookieConsent()` fresh every time it
  runs and either loads both pixels (if `marketing` is true) or revokes
  both (if not) — this single function is both the initial-load path and
  the consent-change-reaction path.
- **`attachConsentListener()`**: adds a `window` listener for
  `"tresse:cookieConsentUpdated"` calling `applyConsent()` again —
  guarded by `listenerAttached` so it's only ever attached once even if
  `initMarketingPixels()` were somehow called more than once.
- **`initMarketingPixels()`** itself is just `attachConsentListener()`
  then `applyConsent()` — so calling it once at app start both handles a
  returning visitor who already consented (loads immediately) and wires
  up the ongoing listener for a consent change later in the same session.

**What it talks to:** `components/cookies/cookiePreferences.ts`
(`getCookieConsent`), the DOM (`document.createElement("script")`,
`document.head.appendChild`, `document.getElementById`), `window`
(dispatches/listens for the custom event, sets `window.fbq`/`window.ttq`/
`window.TiktokAnalyticsObject`), and indirectly the real vendor scripts
once injected (`https://connect.facebook.net/en_US/fbevents.js`,
`https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=...`).

**Watch out for:**
- The pixel ids are hardcoded constants here (`META_PIXEL_ID =
  "4422176017804002"`, `TIKTOK_PIXEL_ID = "D8QLFQJC77UDQUH99PN0"`), with
  a comment noting they're "same pixel ids previously hardcoded in
  `index.html`" — moved, not made configurable via an env var.
  **Unverified** whether that's a deliberate choice (these ids aren't
  secret) or worth revisiting for staging/production separation.
- `revokeMarketingConsent` calling the vendor's revoke API does **not**
  remove the injected `<script>` tag or reset `metaLoaded`/`tiktokLoaded`
  — a later re-grant of consent in the same session (another
  `"tresse:cookieConsentUpdated"` event with `marketing: true`) hits
  `loadMetaPixel`/`loadTikTokPixel` again, which see the flag already
  `true` and no-op on the *injection* step but *do* re-fire
  `fbq("init", ...)` + `fbq("track", "PageView")` / `ttq.load(...)` +
  `ttq.page()` — **unverified** whether re-firing `init`/`load` on an
  already-loaded pixel SDK has any side effect worth worrying about;
  reads as intentional-but-unstated rather than an obvious bug.

**Interview questions:**
- *Q: Why build a manual "stub" object instead of just calling
  `injectScript` and waiting for it to load before calling `fbq(...)`?*
  — Because Meta's and TikTok's own official snippets work this exact
  way — the stub is what lets `fbq("init", ...)` be called synchronously,
  immediately, without an app-side `await`/`onload` callback, matching
  how every other site that embeds these pixels expects to write calling
  code; reimplementing the vendor's own bootstrap pattern here (instead
  of only running it from `index.html`) is what let the P0-07 fix move
  pixel loading behind a runtime consent check without changing how
  `trackMeta`/`trackTikTok` themselves are written.
- *Q: Walk through exactly what happens, in order, when a visitor who
  already has marketing consent from a previous session loads any page.*
  — `App.tsx`'s `useEffect` calls `initMarketingPixels()` once.
  `attachConsentListener()` wires up the event listener. `applyConsent()`
  reads `getCookieConsent()`, sees `marketing: true`, and calls both
  `loadMetaPixel()` and `loadTikTokPixel()` — each ensures its stub,
  injects its script tag, and fires its init + first-pageview call
  through the stub (queued, since the real script hasn't executed yet).
  Once the real `fbevents.js`/`events.js` finishes downloading and
  executing, it replaces the stub's internals and flushes the queued
  calls for real.
- **Harder follow-up:** *Q: This file's tests
  (`pixelLoader.test.ts`) assert `initMarketingPixels()` called twice
  injects each script only once. Given the module-level `metaLoaded`/
  `tiktokLoaded` flags, what test setup is required to make that
  assertion meaningful rather than trivially true?* — A: Nothing extra
  is required *within* a single test — calling the exported function
  twice in the same test naturally hits the same module-scoped flags.
  What the test file does have to manage is *between* tests: every test
  calls `vi.resetModules()` and a fresh dynamic `import("./pixelLoader")`
  in `loadPixelLoader()`, specifically so each test starts with fresh
  `metaLoaded`/`tiktokLoaded`/`listenerAttached` state rather than
  inheriting `true` flags left over from a previous test's calls to the
  same cached module instance.

---

### `src/utils/metaPixel.test.ts`, `tiktokPixel.test.ts`, `pixelLoader.test.ts`

**What they mock, as a group:** `metaPixel.test.ts` and
`tiktokPixel.test.ts` both `vi.mock` `../components/cookies/cookiePreferences`
down to just `{getCookieConsent: vi.fn()}` — real cookie-consent logic
never runs, only the mock's return value matters. `pixelLoader.test.ts`
does **not** mock `cookiePreferences` — it calls the real
`acceptAllCookies()`/`rejectOptionalCookies()` functions so consent is
genuinely written to `localStorage` and genuinely dispatches the real
`"tresse:cookieConsentUpdated"` event, exercising the full
loader↔consent-module integration rather than a mocked boundary.

**What they assert, as a group:** `metaPixel.test.ts`/`tiktokPixel.test.ts`
mirror each other exactly: no consent recorded → no call; consent
recorded with `marketing: false` → no call; `marketing: true` → the
vendor function is called with the exact event name/data; consent
granted but the vendor global isn't present → doesn't throw.
`pixelLoader.test.ts` asserts, by querying the real injected `<script>`
elements in `document.head` (via a `src^=` CSS selector, not a mock):
no script for no/rejected consent; exactly one script per vendor
injected with the correct pixel id embedded in the TikTok script's `src`
query string and the correct queued `fbq`/`ttq` calls (`["init",
"4422176017804002"]`, `["track", "PageView"]`, a `"page"` entry in
TikTok's queue); calling `initMarketingPixels()` twice, or firing the
consent-updated event twice, injects nothing extra; a revoke after
loading calls both vendor revoke APIs (spied via `vi.spyOn` on the real
`window.ttq.revokeConsent`, and by inspecting `window.fbq`'s queue for a
`["consent", "revoke"]` entry); revoking when nothing was ever loaded
leaves `window.fbq`/`window.ttq` both `undefined` (no accidental
creation of the stub just to revoke against it).

**Interview question:** *Q: Why does `pixelLoader.test.ts` avoid mocking
`cookiePreferences.ts` when the two vendor-pixel test files mock it
directly?* — Because `pixelLoader.ts`'s whole job *is* the
consent-integration wiring (listening for the real event, reading the
real stored consent) — mocking that away would leave nothing meaningful
to test; `metaPixel.ts`/`tiktokPixel.ts`, by contrast, only care about
the boolean result of `getCookieConsent()?.marketing`, so mocking the
function directly to return canned values is simpler and keeps those
tests from depending on `pixelLoader.ts`'s DOM-injection behavior at all.

---

## `hooks/`

Two custom hooks, both reusable across many components — one keeps the
wishlist count in sync across browser tabs, the other is the shared
modal-dialog behavior (focus, Escape, overlay click, Tab trap) every
modal in the app is built on.

### `src/hooks/useAuthStorageSync.ts`

**What it is:** A `window` `"storage"` event listener, wired up once from
`App.tsx`.

**Why it exists:** The `"storage"` event fires in *other* tabs/windows of
the same origin when `localStorage` changes in *one* of them — this is
what keeps the wishlist count consistent if the user has the site open in
two tabs and logs out (or adds a wishlist item) in one of them.

**What it exports:** `export default function useAuthStorageSync()`
(no arguments, no return value — pure side effect). Called once, from
`App.tsx`.

**How it works:** On mount, adds a `"storage"` listener that checks
`e.key`: if it's `"token"`, dispatches `fetchWishlistCount()` when
`e.newValue` is truthy (another tab just logged in) or `setCount(0)`
when it's falsy (another tab just logged out/cleared the token); if it's
`"wishlist:ping"`, dispatches `fetchWishlistCount()` unconditionally —
this is a dedicated, valueless key some other part of the app writes
purely to *trigger* the storage event as a cross-tab signal (the value
itself doesn't matter, only that a write happened), written by
`Header.handleLogout` and `WishList.handleRemove` per the fixes
documentation (**unverified** by direct read of those two files in this
pass).

**What it talks to:** `store/wishListSlice.ts` (`fetchWishlistCount`,
`setCount`), `utils/hooks.ts` (`useAppDispatch`), the browser's
`"storage"` event / `localStorage` (indirectly — this hook only reads
the event's `key`/`newValue`, it doesn't call `localStorage` itself).

**Watch out for:** The `"token"` branch checks `e.key === "token"`, but
per `types/token.ts`, the actual key the app writes to is `"access"`
(`ACCESS_KEY = "access"`) — `"token"` is one of the *legacy* keys
`clearTokens()` removes for cleanup, not the key anything currently
*sets*. That means this branch is effectively dead in the current app: no
code path writes to `localStorage["token"]` anymore, so the storage event
this listener is watching for on login/logout never fires from that key.
Only the `"wishlist:ping"` branch is live. This matches audit item P3-05
exactly ("`useAuthStorageSync` listens for `e.key === "token"`; the token
is stored under `access`, so that branch is dead").

**Interview questions:**
- *Q: Why is a dedicated `"wishlist:ping"` key needed at all, instead of
  relying on whatever key the wishlist count itself might be stored
  under?* — The wishlist count isn't persisted to `localStorage` at
  all — it's live Redux state, refetched from the server. `"wishlist:ping"`
  exists purely as a cross-tab *signal* (any write to it fires the
  `"storage"` event in other tabs), not as a value anything reads back.
- *Q: The `"token"` branch here is effectively dead — what would need to
  change for it to start working again?* — Either this hook would need to
  watch `e.key === "access"` instead, or something would need to resume
  writing to a literal `"token"` key — the cleaner fix, given
  `types/token.ts` already treats `"token"` as a legacy key to be
  removed, is updating the check here to match the actual key in use.

---

### `src/hooks/useDialogDismiss.ts`

**What it is:** The shared modal-dialog behavior hook — every modal in
the app (`ProductModal`, `CustomMeasurementsModal`,
`CookieSettingsModal`, and `NotifyModal`/`SizeModal`/`CustomLengthModal`
inside `ProductCatalog.tsx`, per the fixes documentation) wires this hook
up rather than reimplementing focus/Escape/overlay/Tab handling itself.

**Why it exists:** Four pieces of behavior every accessible modal needs —
move focus in on open, restore it on close, close on Escape, close on an
overlay click, and trap Tab/Shift+Tab inside the dialog — used to be
partially implemented per-modal (or not implemented at all, for
`CookieSettingsModal` before its fix) and are now written once here.

**What it exports:** `useDialogDismiss(overlayRef, contentRef, onClose,
active = true)` — no return value; a pure side-effect hook.

**How it works:**
- **Two `useEffect`s.** The first just keeps `onCloseRef.current` synced
  to the latest `onClose` on every render — no dependency array, so it
  runs after every render unconditionally (cheap: it's a single ref
  assignment). The second — the real one, marked with a `biome-ignore
  lint/correctness/useExhaustiveDependencies` comment explaining why — has
  `[active]` as its only dependency, deliberately excluding `overlayRef`/
  `contentRef` (stable `RefObject`s that never change identity) and
  `onClose` (read through `onCloseRef` instead).
- **On activation** (`active` true, effect (re-)runs): captures
  `document.activeElement` as `previouslyFocused`, focuses
  `contentRef.current` immediately (this only works if the content
  element has `tabIndex={-1}` — a plain `<div>`/`<section>` isn't
  focusable by default; every modal that uses this hook sets that on the
  dialog root per the fixes documentation), then attaches a `keydown`
  listener on `window` (not the dialog itself — this is why Escape/Tab
  work even if focus is technically on `document.body` for a moment) and
  a `mousedown` listener on `overlayRef.current` specifically.
- **The Tab trap**, inside the same `keydown` handler: ignores every key
  except `Tab`. Recomputes `getFocusableElements(contentRef.current)` on
  *every* keydown (not cached) — matching `a[href]`, non-disabled
  `button`/`input`/`select`/`textarea`, and any `[tabindex]` other than
  `"-1"`. With zero focusable descendants, `e.preventDefault()` and
  refocus the container itself (so Tab can't escape a dialog with, say,
  only static text and no controls yet). Otherwise: focus currently on
  the container itself → Tab goes to first, Shift+Tab to last; focus on
  the first element with Shift+Tab held → wrap to last; focus on the last
  element with Shift+Tab *not* held → wrap to first; any other position
  is left alone (native Tab order handles it, since the browser's default
  behavior already keeps it inside the DOM subtree the listener doesn't
  otherwise interfere with — **this hook never needs to actively move
  focus for a middle element**, only at the two wrap-around edges and the
  container-itself case).
- **The overlay click check**: `e.target === overlayRef.current` — a
  strict identity check, not `contains()` — so a mousedown that starts on
  the overlay *element itself* (the backdrop) closes the dialog, but one
  that starts on any descendant (including the dialog content, which sits
  visually on top of the overlay but is a separate child in the DOM)
  does not, even though event bubbling would otherwise make every click
  "hit" the overlay too if this checked `currentTarget` instead of
  `target`.
- **Cleanup** (on `active` becoming false, or unmount): removes both
  listeners and calls `previouslyFocused?.focus()` — restoring focus to
  whatever triggered the dialog's opening (a "NOTIFY ME" button, a
  "Cookie Settings" link, etc.).

**What it talks to:** The two `RefObject`s the caller supplies (never
creates its own refs to the overlay/content), `document.activeElement`,
`window` (`keydown`), the DOM element the `overlayRef` points to
(`mousedown`).

**Watch out for — this is the file's whole reason for existing as a
separate hook rather than inline logic per modal:**
- **The `onCloseRef` pattern is a deliberate re-render-loop avoidance,
  not incidental.** If the effect depended on `onClose` directly, then
  every parent re-render that passes a fresh inline arrow function (the
  normal React pattern, e.g. `onClose={() => setOpen(false)}`) would give
  the effect a new dependency value, tearing down and re-running it —
  which would re-focus the dialog content and re-capture
  `previouslyFocused` on *every* parent re-render, not just on genuine
  open/close transitions. Typing into a form field inside the modal (if
  the modal's parent re-renders on every keystroke, e.g. a lifted
  controlled input) would otherwise repeatedly steal focus back to the
  dialog container mid-keystroke. Routing `onClose` through a ref
  sidesteps this entirely, at the cost of the `biome-ignore` comment
  being necessary to suppress the linter's (in this case incorrect)
  exhaustive-deps warning.
- **`active` defaults to `true`**, which is correct *only* for a modal
  component that's conditionally mounted/unmounted by its parent (mount
  = open). A modal that instead stays mounted and toggles its own `open`
  prop must pass `active={open}` explicitly — the doc comment says this
  directly, but it's easy to get wrong for a new modal that copies an
  existing usage without checking which pattern that existing modal
  follows.
- Recomputing `getFocusableElements` on every `Tab` keydown (rather than
  once on open) means a modal whose focusable set changes while open
  (e.g. a field becomes enabled) stays correctly trapped without needing
  to explicitly recompute anything — a deliberate trade of a small,
  bounded `querySelectorAll` cost per Tab press for correctness under a
  changing DOM.

**Interview questions:**
- *Q: Why does the Tab-trap keydown listener live on `window` instead of
  on the dialog `contentRef` element itself?* — Because focus can, even
  briefly, end up somewhere the content element's own listener wouldn't
  catch (e.g. exactly at the moment focus moves during the trap logic
  itself, or before the initial `contentRef.current?.focus()` call has
  taken effect) — a `window`-level listener catches every keydown
  regardless of where focus currently sits, which matters for both
  Escape and the Tab trap working reliably from the very first keystroke.
- *Q: Why compare `e.target === overlayRef.current` instead of checking
  whether the click was outside the dialog content?* — They're
  equivalent in this DOM structure (the overlay is a sibling backdrop
  behind the content, not a wrapper the content is nested inside — a
  click that starts on the content never has the overlay as its
  `target`), and using `target` directly avoids needing a second ref
  comparison or a `.contains()` call against the content element.
- *Q: What's the exhaustive-deps comment protecting against, concretely?*
  — Without it (or without the `onCloseRef` workaround it documents),
  Biome's lint rule would flag `onClose` as a missing dependency of the
  second `useEffect`; adding it directly would be *correct* per the rule
  but *wrong* for this component's actual behavior, since it would
  reintroduce the re-render-driven refocus bug the ref pattern exists to
  avoid — the comment is there so a future maintainer doesn't "fix" the
  lint warning by breaking the intended behavior.
- **Harder follow-up:** *Q: The overlay `mousedown` listener is attached
  imperatively via `addEventListener` rather than as a JSX `onMouseDown`
  prop on the overlay element. Why does that matter, beyond style?* — A:
  The hook's own doc comment says so directly: attaching it imperatively
  keeps the overlay "a plain, non-interactive backdrop for assistive
  tech rather than an element with a JSX `onClick`/`role` combo" — a JSX
  handler on the overlay would typically come paired with making it
  keyboard-interactive (a `role`/`tabIndex`/`onKeyDown` to satisfy
  a11y-lint rules for a clickable non-button element), which isn't
  wanted here: the overlay isn't meant to be a *focusable* control at
  all, only a click target, and Escape/Tab are already handled by the
  `window`-level listener instead.

---

### `src/hooks/useDialogDismiss.test.tsx`

**What it mocks:** Nothing — renders a real `TestDialog` fixture
component (defined in the test file itself) wrapping the hook, with a
configurable number of focusable `<button>` controls (default 3).

**What it asserts, in two groups:**
- **Focus trap** (the newer coverage, added alongside the Tab-handling
  code itself): Tab from the last control wraps to the first; Shift+Tab
  from the first wraps to the last; Tab from a *middle* control does
  **not** get redirected (left to native tab order, which `jsdom` doesn't
  actually simulate — the test only asserts the hook didn't
  interfere, not that focus visibly moved anywhere); Tab or Shift+Tab
  from the dialog container itself (its initial focus target) goes to
  the first/last control respectively; with zero focusable descendants,
  focus stays on the container after a Tab press.
- **Existing behaviour is unchanged** (regression coverage for
  everything the hook already did before the Tab trap was added):
  Escape calls `onClose`; a `mousedown` on the overlay calls `onClose`; a
  `mousedown` on the dialog content does **not**; focus moves into the
  dialog on mount; unmounting restores focus to whatever element was
  focused before the dialog opened (built with a real `<button>`
  appended to `document.body`, focused, then the dialog rendered and
  unmounted around it).

**Interview question:** *Q: Why does this test file keep an explicit
"existing behaviour is unchanged" group instead of just adding the new
focus-trap tests?* — Because the Tab trap was added to a hook that
several modals across the app already depended on for Escape/overlay/
focus-restore behavior — re-asserting that behavior in the same PR that
changed the hook's `keydown` handler is what proves the new Tab-handling
code didn't regress the existing paths through the same event listener,
rather than trusting that a change to one `if` branch couldn't possibly
affect the others.

---

## `types/`

Plain TypeScript type/interface declarations — no runtime logic, no
Redux, no components. `types/token.ts` is the one exception: despite
living in this folder, it exports real runtime functions (the actual
`localStorage` access layer), not just types — it's covered in full here
rather than in `utils/`, matching where it physically lives.

### `src/types/ pagination.ts`

**What it is:** A generic `Paginated<T>` type (`{count, next, previous,
results: ReadonlyArray<T>}`) — the DRF `PageNumberPagination` response
shape.

**Watch out for — the filename itself:** this file is named
`" pagination.ts"`, with a **leading space** before the name (confirmed
with `ls -la`: the literal directory entry is `␣pagination.ts`). A
repo-wide search for any import of it (`grep -rn "pagination" src`,
filtered to exclude `api/products.ts`'s own locally-declared
`Paginated<T>`) finds **zero** references anywhere in the app. It's
unused, and the leading space would make it awkward to import cleanly
even if something tried to (`from "../types/ pagination"`, with the
space, is valid but unusual enough that most editors/IDEs would mangle
it on autocomplete). `api/products.ts` declares its own, differently-shaped
`Paginated<T>` (with `results: T[]` instead of `ReadonlyArray<T>`)
locally instead of importing this one — the two types aren't even
structurally identical, just similarly named.

**Interview question:** *Q: If you were asked to consolidate pagination
typing across the app, what would you do with this file?* — Rename it to
drop the leading space, reconcile it with `api/products.ts`'s local
`Paginated<T>` (pick one array type — `T[]` vs `ReadonlyArray<T>` — and
have `products.ts` import the shared one instead of redeclaring it), and
confirm via a repo-wide import search that nothing currently depends on
either shape before changing it.

---

### `src/types/auth.ts`

**What it is:** The auth-related request/response/state types:
`LoginFormData`/`LoginRequest` (identical, kept as separate named types
"for clarity" per the file's own comment), `RegisterFormData`/
`RegisterRequest`, `ResponseData` (`{access, refresh, user}` — the
login/register API response shape), `AuthState` (`{token, user,
isLoggedIn}` — matches `utils/authSlice.ts`'s Redux state exactly).

**What it talks to:** `types/user.ts` (`User`). Imported by
`api/auth.ts`, `utils/authSlice.ts`, and presumably `components/Authorization.tsx`/
`Register.tsx` (**unverified** by direct read of those two in this pass).

**Watch out for:** `RegisterFormData`/`RegisterRequest` use snake_case
(`first_name`, `last_name`, `phone_number`) even though it's explicitly
labeled "Frontend form shape (UI)" — most of this codebase's *other*
form-state types (e.g. `ProfileFormState` below) use camelCase for the
UI-facing shape and snake_case only for the API payload; this one skips
that distinction and uses the same snake_case shape for both, presumably
because the register form's fields map onto the API fields one-to-one
with no separate UI-friendly naming needed.

**Interview question:** *Q: Why declare `LoginRequest = LoginFormData`
as a separate type alias instead of just using `LoginFormData` directly
in `api/auth.ts`'s function signature?* — Purely for reading clarity at
the call site — a function signature that says `(data: LoginRequest)`
documents *intent* (this is what gets sent over the wire) even though,
structurally, it's identical to the form's own shape; if the two ever
needed to diverge (e.g. the API started requiring a field the form
doesn't collect directly), the alias gives a natural place to change
just one of them without an app-wide rename.

---

### `src/types/cart.ts`

**What it is:** Two families of cart types that don't share a common
base: the **server** cart DTOs (`CartProductMini`, `CartSizeRef`,
`CartProductSize`, `CartItemDto`, `CartDto` — matching
`CartSerializer`/`CartItemSerializer`'s JSON shape from
`tresse_backend/products/serializers.py`) and a **separately
hand-maintained** `GuestCartItem` type used specifically by
`view/Cart.tsx`.

**What it talks to:** Consumed by `store/serverCartSlice.ts`
(`CartDto`, `CartItemDto`) and, per its own comment, `view/Cart.tsx` for
the guest-side `GuestCartItem`.

**Watch out for — the two `GuestCartItem` types are not the same type:**
`utils/cartSlice.ts` defines its *own* `GuestCartItem` as `Product &
CustomMeasurements & CustomLengthFields & {lineId, quantity,
product_size_id, sizeName?, maxQty?}` (spreading the full `Product`
type from `types/product.ts`), while *this* file's `GuestCartItem` is a
flat, independently hand-written type with a narrower, overlapping-but-
different field list (e.g. it has `main_image_url?`/`images?` typed
inline rather than inheriting them from `Product`, and its own comment
warns: "IMPORTANT: keep it compatible with what `cartSlice` actually
stores" — an manually-maintained-invariant, not something TypeScript
enforces structurally between the two files). This is exactly the kind
of duplication a refactor could silently break — if `utils/cartSlice.ts`'s
`GuestCartItem` gains a field, nothing forces `types/cart.ts`'s copy to
follow, and `view/Cart.tsx` (which imports this file's version, per the
[[P1-10]] fixes documentation) would simply not know about the new field
at the type level even though the actual runtime objects have it.

**Interview question:** *Q: Given that `utils/cartSlice.ts` already
exports its own `GuestCartItem` type, why does `view/Cart.tsx` use a
separately-declared one from `types/cart.ts` instead of importing the
slice's?* — **Unverified** from the code alone — no comment explains the
split, only a warning to keep them compatible by hand; it may be a
historical accident (the two were written independently and never
consolidated) rather than a deliberate design choice, and it's a
concrete maintenance risk: it's on a developer's memory, not the
compiler, to keep the two definitions in sync.

---

### `src/types/product.ts`

**What it is:** The full `Product` shape returned by the catalog/product
endpoints, plus `ProductImage`, `SizeRef`, `ProductSizeInline`,
`ProductVariant`, `ProductGroupDto`, `CategoryDto`, `CollectionDto`.

**What it talks to:** Imported by `api/products.ts` (`fetchProducts`'s
return type), `utils/cartSlice.ts` (`GuestCartItem = Product & ...`),
and presumably `view/ProductCatalog.tsx`/`view/ProductDetails.tsx`/
`view/WishList.tsx` (**unverified** exhaustively in this pass).

**Watch out for:** `price` is typed `string` (backend serializes
`Decimal` fields as strings — DRF's default for `DecimalField`), and
several money-adjacent fields follow the same pattern
(`custom_length_surcharge?: string | number | null` — looser than
`price`, allowing either representation, which is why call sites that do
arithmetic on it (e.g. `utils/cartSlice.ts`'s `toMoney` helper) always
coerce with `Number(...)` rather than trusting the type to already be
numeric. `group`/`variants`/`color_*` fields describe a
color-variant-grouping feature (a product with multiple color options,
each with its own `main_image_url`) — **unverified** how fully that
feature is wired up in `view/` without reading those files directly.

**Interview question:** *Q: Why is `price` typed as `string` instead of
`number`?* — It mirrors what the backend actually sends: DRF serializes
`DecimalField`s as JSON strings by default specifically to avoid the
floating-point precision loss `number` would introduce for currency
values — the frontend type follows the wire format rather than
converting eagerly, leaving each consumer to parse with `Number(...)`
(or a helper like `toMoney`) at the point where arithmetic is actually
needed.

---

### `src/types/profile.ts`

**What it is:** `ProfileFormState` (camelCase — the Dashboard form's own
local state shape), `ProfileResponse` (snake_case, all fields optional —
the `GET /accounts/profile/` response shape), `ProfileUpdatePayload`
(snake_case, most fields required — the `PUT /accounts/profile/` request
body shape).

**What it talks to:** `accounts/serializers.py`'s `ProfileSerializer`
and `accounts/views.py`'s `ProfileAPIView` on the backend — as of the
[[P1-04]] fix, both the GET response and PUT request use snake_case keys
(`first_name`, `address_line1`, `postal_code`, etc.), which is exactly
what `ProfileResponse`/`ProfileUpdatePayload` already declare here. This
file's snake_case typing was correct *before* the backend fix too — the
mismatch that P1-04 fixed was entirely in `ProfileSerializer`/`ProfileAPIView`
using camelCase keys the frontend never sent or read; this type file was
never the source of the bug.

**Watch out for:** `ProfileFormState` (camelCase) and
`ProfileUpdatePayload`/`ProfileResponse` (snake_case) are three distinct
types for what is conceptually one profile record — presumably
`view/Dashboard.tsx`'s `mapFormToApi`/`mapApiToForm` functions (named in
the P1-04 fixes documentation) convert between them; this file itself
does no conversion, just declares the three shapes.

**Interview question:** *Q: Why does the form state use camelCase while
the API types use snake_case, instead of using one convention
throughout?* — camelCase is the idiomatic convention for a
React/TypeScript form's local state (matching every other form in this
codebase), while snake_case matches what the Django/DRF backend actually
sends and expects on the wire — keeping them as separate types with an
explicit mapping function (`mapFormToApi`/`mapApiToForm`) at the
boundary is what let the [[P1-04]] fix change only the API-facing
serializer/view without touching the form component's own state shape at
all.

---

### `src/types/user.ts`

**What it is:** `User` — `{id, email, first_name, last_name}`. Six
lines, no logic.

**What it talks to:** Imported by `types/auth.ts`, `utils/authSlice.ts`,
`App.tsx` (`toUserOrNull`'s target shape).

**Interview question:** *Q: Why does `User` only have four fields when
the profile system (`types/profile.ts`) tracks address, city, country,
etc.?* — `User` represents the *auth* identity — what's embedded in a
login/register response and what `App.tsx` validates before restoring a
session from `localStorage` — while the address/profile fields are a
separate, larger record fetched only when the Dashboard page actually
needs it (`GET /accounts/profile/`), not carried on every request that
needs to know who's logged in.

---

## `components/`

Cross-page building blocks: full auth-flow pages that don't fit neatly
under `view/` because they're more "component" than "page" in this
codebase's own organization (`Authorization.tsx`, `Register.tsx`,
`AccountRestore.tsx`, `PasswordChange.tsx`, `PasswordResetConfirm.tsx`,
`LoginChoice.tsx`), two modals (`CustomMeasurementsModal.tsx`,
`ProductModal.tsx`), and the cookie-consent system in its own
`cookies/` sub-folder. Nothing here owns a top-level route mapped
directly in `App.tsx`'s route table by folder convention — several of
these files *are* routed pages (per `App.tsx`'s route table,
`Authorization`, `Register`, `AccountRestore`, `PasswordChange`,
`PasswordResetConfirm`, and `LoginChoice` are all routed) — the
`view/`/`components/` split in this codebase is not strictly "page vs.
reusable," despite the name.

### `src/components/Authorization.tsx`

**What it is:** The login page/form.

**Why it exists:** Owns the login form, its Yup validation schema, the
login submission flow (call the API, store credentials, kick off
post-login data fetches, navigate), and open-redirect-safe handling of a
`?next=` query param.

**What it exports:** `export default function Authorization()`. Routed
at both `/login` and `/authorization` in `App.tsx`.

**How it works:**
- Validates with a local Yup schema (`email` required + valid, `password`
  required only — no length check on login, unlike register/reset, since
  login just needs to match whatever's already stored).
- Reads `?next=` from the URL via `useLocation` + `URLSearchParams`
  (not React Router's `useSearchParams`), validates it with a
  locally-redeclared `isSafePath` (yet another copy of the same
  `startsWith("/") && !startsWith("//")` check that exists independently
  in `App.tsx`, `utils/PrivateRoute.tsx`, and `utils/routing.ts` — four
  separate implementations of the identical open-redirect guard across
  the codebase).
- **`onSubmit`**: calls `loginUser(data)` (`api/auth.ts`). Validates the
  response shape with local guards (`isLoginResponse`, `toNonEmptyStringOrNull`,
  `toUserOrNull` — this file has its own copy of `toUserOrNull`, nearly
  identical to `App.tsx`'s). If `access` or `user` fail validation, shows
  a generic "Login failed" message rather than trusting a malformed
  response. On success: dispatches `setCredentials({token: access, user,
  refresh: refresh ?? undefined})` — see Watch out for below on why the
  `refresh` field matters. Then runs `mergeGuestCart()` and `fetchCart()`,
  each in its **own** `try/catch` that only `console.warn`s in dev and
  never blocks — the pattern this file established that `Register.tsx`
  was later fixed to match (see [[P1-13]]). Finally dispatches
  `fetchWishlistCount()` (also individually try/caught) and navigates to
  `safeNext ?? "/"` with `replace: true`.
- **`getLoginErrorMessage`**: checks `isAxiosError` first — 401/400 both
  collapse to a single generic "Invalid email or password." (deliberately
  not leaking *which* field was wrong, standard practice for a login
  form), otherwise reads `response.data.detail` if present, otherwise a
  generic "Something went wrong." A code comment explains that in
  practice this whole `isAxiosError` branch rarely runs: `loginUser()` in
  `api/auth.ts` already unwraps any `AxiosError` into a plain `Error`
  carrying the extracted message via its own `getErrorMessage`, so what
  actually reaches this function is usually a plain `Error`, handled by
  the `instanceof Error` branch below it.

**What it talks to:** `api/auth.ts` (`loginUser`), `store/serverCartSlice.ts`
(`fetchCart`, `mergeGuestCart`), `store/wishListSlice.ts`
(`fetchWishlistCount`), `utils/authSlice.ts` (`setCredentials`),
`utils/hooks.ts`, backend: `POST /accounts/token/`.

**Watch out for — fixed as of commit `934604b`, described here for
context since it's a natural interview question:** this call site used
to write the refresh token to `localStorage` **manually**
(`if (refresh) localStorage.setItem("refresh", refresh)`) and then
immediately dispatch `setCredentials({token: access, user})` with **no**
`refresh` field — which, inside `authSlice.ts`'s reducer, took the
"no refresh was passed" branch and called `removeRefreshToken()`,
deleting the value this component had just written two lines above. The
net effect was that no refresh token ever survived a login, regardless
of whether the backend returned one, and `Authorization.test.tsx` never
asserted on `localStorage["refresh"]`'s final value, so nothing caught
it. The fix was exactly what it looks like: pass `refresh` through to
`setCredentials` instead of writing to `localStorage` by hand, and let
the reducer (which already handled a present `refresh` correctly) do the
storing. `Authorization.test.tsx` now has "stores the refresh token
after a successful login," asserting `localStorage.getItem("refresh")`
directly against a `types/token` mock that delegates to real
`localStorage` rather than being a no-op spy. **`Register.tsx` had the
identical bug and received the identical fix** — see below.

**Interview questions:**
- *Q: Why does `onSubmit` call `dispatch(setCredentials(...))` before
  awaiting `mergeGuestCart()`/`fetchCart()`, rather than waiting for
  those to resolve first?* — So the user is considered logged in (Redux
  `isLoggedIn: true`, token persisted) immediately, and a slow or failed
  cart merge/fetch can't block or fail the login itself — exactly the
  reasoning `Register.tsx`'s later fix (P1-13) made explicit for the
  register flow too.
- *Q: Trace exactly what happens to the refresh token returned by a
  successful login, as the code stands today.* — `loginUser`'s response
  is validated, then `refresh` is passed straight into `setCredentials`'s
  payload; `authSlice.ts`'s reducer calls `setRefreshToken(refresh)`
  (`types/token.ts`), which persists it to `localStorage`. From there,
  `api/axiosInstance.ts`'s response interceptor reads it via
  `getRefreshToken()` the next time an access-token refresh is needed.
- **Harder follow-up:** *Q: This exact call site used to have a bug where
  a manual `localStorage.setItem("refresh", ...)` was silently undone two
  lines later by a `setCredentials` dispatch that omitted the `refresh`
  field. Why would a bug like that survive code review and a green test
  suite?* — Because the two lines, read in isolation, each look correct:
  the manual write looks like it's doing its job, and `setCredentials`
  being called with `{token, user}` looks like ordinary login code unless
  the reader also holds `authSlice.ts`'s reducer logic in their head and
  notices it treats a *missing* `refresh` as "clear the stored one," not
  "leave it alone." The existing test asserted only that navigation
  happened, not what ended up in storage, so nothing forced that
  cross-file interaction to be checked. The fix that landed (`934604b`)
  addressed exactly that: pass `refresh` through instead of writing to
  storage by hand, and add a test that asserts the storage side effect
  directly.

---

### `src/components/Register.tsx`

**What it is:** The registration page/form.

**Why it exists:** Same shape of responsibility as `Authorization.tsx`,
for account creation instead of login, plus one extra branch: a
registration can succeed (`access` returned) without a usable `user`
object, in which case the flow redirects to `/authorization` instead of
logging the user in directly.

**What it exports:** `export default function Register()`. Routed at
`/register`.

**How it works:** Structurally near-identical to `Authorization.tsx` —
its own Yup schema (adds `first_name`, `last_name`, a phone-number regex,
and a `.min(8, ...)` on the password, unlike login), its own local copies
of `isRecord`, `isSafePath`, `toNonEmptyStringOrNull`, `toUserOrNull` (a
**fourth** copy of the same open-redirect check, and a **third** copy of
`toUserOrNull`, alongside `App.tsx`'s and `Authorization.tsx`'s). The one
real branch difference: if `registerUser`'s response has `access` but no
usable `user`, it navigates to `/authorization?next=<safeNext>` instead
of logging in directly — registration succeeded, but the caller has to
log in separately to establish a full session (**unverified** exactly
which backend response shape triggers this branch in practice, since
`RegisterAPIView.post` in `tresse_backend/accounts/views.py` — read
while researching the fixes documentation — does appear to return a
`user` object on success; this branch may exist mainly as defensive
coding for an unexpected response shape).

**The `mergeGuestCart`/`fetchCart` individual try/catch pattern**
(described fully in the P1-13 fixes documentation and pinned by
`Register.test.tsx`'s "still navigates and shows no error when
`fetchCart` fails after a successful registration" test) is the direct
fix for a real bug: before it, a transient `fetchCart` failure right
after a successful registration surfaced as "Registration failed. Please
try again." even though the account existed, tokens were stored, and the
user was already logged in — retrying then failed a second time with
"User with this email already exists."

**What it talks to:** Same set as `Authorization.tsx`: `api/auth.ts`
(`registerUser`), `store/serverCartSlice.ts`, `store/wishListSlice.ts`,
`utils/authSlice.ts`. Backend: `POST /accounts/register/`.

**Watch out for — fixed as of commit `934604b`, same bug and same fix as
`Authorization.tsx` above:** this call site used to write the refresh
token to `localStorage` manually and then dispatch
`setCredentials({token: access, user})` with no `refresh` field, so
`authSlice.ts`'s reducer deleted the just-written token on every
registration too. `Register.test.tsx`'s "navigates to / on full success
with user and token" test even mocked a response that included
`refresh: "refresh123"`, but only asserted on navigation — never on what
ended up in `localStorage["refresh"]` — so it passed both before and
after the fix without ever exercising the bug directly. The fix passes
`refresh` through to `setCredentials` (`dispatch(setCredentials({token:
access, user, refresh: refresh ?? undefined}))`) and removes the manual
`localStorage` write; `Register.test.tsx` now has its own "stores the
refresh token after a successful registration" test asserting
`localStorage.getItem("refresh")` directly.

**Interview questions:**
- *Q: What's the one meaningful behavioral difference between `Register.tsx`
  and `Authorization.tsx`'s submit handlers?* — Registration handles the
  case where the API returns an `access` token but no usable `user`
  object by redirecting to `/authorization` instead of logging the user
  in directly — login has no equivalent branch, since a login response
  without a valid `user` is just treated as a failed login.
- *Q: Why does `Register.test.tsx` reset `mockedGetAccessToken` to `null`
  in `beforeEach` with an explicit comment, when `Authorization.test.tsx`
  doesn't do the same thing as explicitly?* — The comment in the test
  explains it: `hasToken()` inside `serverCartSlice.ts` reads
  `getAccessToken()` directly, independent of Redux state — so a
  previous test in the same file that mocked it to return a token could
  otherwise leak into a later test's `mergeGuestCart`/`fetchCart` thunk
  behavior if the mock weren't reset explicitly every time.

---

### `src/components/AccountRestore.tsx`

**What it is:** The "set a new password to restore your deactivated
account" page, reached from the restore link in the account-deactivation
email.

**Why it exists:** Deleting an account in this app is a soft-deactivation
with a time-limited restore window (see the [[P0-04]] fixes
documentation) — this is the form that consumes the restore link's
`uidb64`/`token` URL params and lets the user set a new password to
reactivate.

**What it exports:** `export default function AccountRestore()`. Routed
at `/account/restore/:uidb64/:token`.

**How it works:** `useParams` gives `uidb64`/`token`; `missingParams` (if
either is absent) switches the whole page to an "invalid link" message
with links to `/login-choice` and `/help` instead of rendering the form
at all. The Yup schema requires the password to be at least 8 characters
and the confirm field to match via `Yup.ref("password")`. On submit,
calls `confirmAccountRestore({uidb64, token, new_password})`
(`api/auth.ts` → `POST /accounts/restore/confirm/`) — as of [[P1-17]],
the backend now runs Django's `validate_password` on this field rather
than only checking length, so a weak-but-8-plus-character password (this
form's own client-side check) can still be rejected server-side with a
more specific message, surfaced via `getErrorMessage`. On success,
schedules a `window.setTimeout` (stored in `timeoutRef`, cleared on
unmount via a `useEffect` cleanup) to navigate to
`/login-choice?next=%2Fdashboard` after 600ms — giving the success
message a moment to be visible before redirecting.

**What it talks to:** `api/auth.ts` (`confirmAccountRestore`).

**Watch out for:** The `timeoutRef` + unmount-cleanup pattern here is
explicitly the *correct* version of a pattern that
`components/PasswordResetConfirm.tsx` (below) does **not** follow — that
file's `window.setTimeout` for its own post-success redirect has no
`ref` and no cleanup at all, matching audit item P3-16 exactly.

**Interview questions:**
- *Q: Why does this form check password length client-side (`.min(8,
  ...)`) when the backend now validates the password properly via
  `validate_password`?* — Fast, no-round-trip feedback for the most
  common failure (too short) — the server-side `validate_password` check
  (common-password/all-numeric/similarity-to-user-attributes checks, per
  Django's validators) still runs and can reject a password that passes
  this client-side check, surfaced through the same `getErrorMessage`
  path as any other server error.
- *Q: Why store the `setTimeout` id in a ref and clear it in a cleanup
  effect?* — If the component unmounts before the 600ms elapses (the
  user navigates away manually, or a fast subsequent action), the timeout
  would otherwise still fire and call `navigate(...)` against an
  unmounted component's stale closure — clearing it on unmount prevents
  a navigation (or, in a component with state updates in the timeout
  callback, a "set state on an unmounted component" warning) from firing
  after the component is already gone.

---

### `src/components/PasswordChange.tsx`

**What it is:** The logged-in "change your password" form (Dashboard →
change password), routed behind `PrivateRoute`.

**Why it exists:** Self-contained current/new/confirm password form and
submission, independent of the auth session flow.

**What it exports:** `export default function PasswordChange()`. Routed
at `/account/change-password`, wrapped in `PrivateRoute`.

**How it works:** Client-side checks — new password ≥ 8 chars, new
equals confirm — before calling `POST /accounts/change-password/` with
`{current_password, new_password, confirm_password}`. Backend:
`ChangePasswordAPIView`, which validates via `ChangePasswordSerializer`
(new/confirm match) and then separately checks `current_password`
against `request.user.check_password(...)`, returning `{"detail":
"Current password is not correct."}` if it's wrong. On success, clears
all three fields and shows a success message — does **not** navigate
away or log the user out (unlike `AccountRestore`/`PasswordResetConfirm`,
which both redirect after success, since those two are meant to end with
a fresh login).

**What it talks to:** `api/axiosInstance.ts` directly (as `api`) — this
file does **not** use `api/account/ChangePassword.ts`'s
`changePassword()` wrapper despite that wrapper existing specifically for
this exact endpoint; it duplicates the request inline instead, with its
own separately-declared local `ChangePasswordPayload` type that happens
to be structurally identical to the one `api/account/ChangePassword.ts`
already exports.

**Watch out for:** This is the same "wrapper exists but isn't used"
pattern the codebase briefly had with the now-deleted `utils/
axiosInstance.ts` (see `api/axiosInstance.ts`'s section) —
`api/account/ChangePassword.ts` is dead code from this component's
perspective (**unverified** whether anything else in the app actually
calls it; if nothing does, it's fully unused, not just unused by this
one component).

**Interview question:** *Q: Given that `api/account/ChangePassword.ts`
already wraps this exact request, why might a component bypass it and
call `api.post` directly instead?* — **Unverified** from the code
itself — no comment explains the choice; the most likely explanations are
that the wrapper was added after this component was already written and
never retrofitted in, or that the two were developed independently
without either author knowing about the other — either way, it's a
concrete instance of the kind of drift that happens when a shared helper
exists but isn't enforced as the only path to an endpoint.

---

### `src/components/PasswordResetConfirm.tsx`

**What it is:** The "set a new password" page reached from a password
*reset* email link (as opposed to `AccountRestore.tsx`'s account
*restore* email link) — a different flow with a similarly-shaped form.

**Why it exists:** Consumes `uidb64`/`token` from
`/reset-password/:uidb64/:token` and calls
`POST /accounts/reset-password/confirm/` with the new password.

**What it exports:** `export default function PasswordResetConfirm()`.
Routed at `/reset-password/:uidb64/:token`.

**How it works:** Nearly identical structure to `AccountRestore.tsx` —
`missingLink` disables the whole form rather than hiding it (a visible,
disabled form plus an explanatory alert, rather than swapping to a
completely different "invalid link" view the way `AccountRestore.tsx`
does), client-side length + match checks, then `POST
/accounts/reset-password/confirm/` with `{uidb64, token, new_password,
confirm_password}`. Backend: `PasswordResetConfirmAPIView` — as of
[[P0-04]], this view now also checks the account's `is_active` and
refuses (same "invalid or expired" response as a bad token) rather than
silently reactivating a deactivated account, so a reset link for a
deleted account no longer bypasses the restore-window policy
`AccountRestore.tsx`'s flow enforces. On success, shows a message and
redirects to `/login-choice` after 900ms via `window.setTimeout`.

**What it talks to:** `api/axiosInstance.ts` directly (like
`PasswordChange.tsx`, not through a wrapper function).

**Watch out for:** The 900ms `window.setTimeout` here has **no** ref and
**no** cleanup on unmount — unlike `AccountRestore.tsx`'s identical-purpose
timeout, which uses `timeoutRef` and clears it in a `useEffect` cleanup.
If a user navigates away from this page manually within the 900ms
window, the timeout still fires and calls `navigate("/login-choice", ...)`
regardless — a low-severity but real inconsistency, matching audit item
P3-16 exactly ("`PasswordResetConfirm` schedules a redirect with
`window.setTimeout` and never clears it on unmount;
`AccountRestore` does this correctly via `timeoutRef`").

**Interview question:** *Q: What's the concrete, observable consequence
of this file's missing timeout cleanup, given that `navigate()` after
unmount doesn't throw in this React Router setup?* — Mainly a stray,
user-invisible navigation call firing against a component that's already
gone — if the user had since navigated to, say, `/cart`, this timeout
could redirect them away to `/login-choice` up to 900ms later with no
warning, overriding a navigation the user made deliberately; it wouldn't
crash, but it's a surprising side effect the `AccountRestore.tsx` pattern
avoids entirely.

---

### `src/components/LoginChoice.tsx`

**What it is:** The "Log In / Register" landing page shown before either
form — a simple choice screen with a background image.

**Why it exists:** Every redirect-to-auth path in the app (`PrivateRoute`,
`App.tsx`'s unauthorized handler) sends the user here first rather than
straight to `/login`, so this page's only real job is forwarding the
`?next=` param onward to whichever choice the user makes.

**What it exports:** `export default function LoginChoice()`. Routed at
`/login-choice`.

**How it works:** Reads `?next=` via `URLSearchParams` (like
`Authorization.tsx`/`Register.tsx`), validates with `isSafePath` — this
time actually imported from `utils/routing.ts` rather than
locally-redeclared, unlike the other three files with their own inline
copies — and appends it to both the "LOG IN" (`/authorization?next=...`)
and "REGISTER" (`/register?next=...`) links.

**Interview question:** *Q: Why does this file import `isSafePath` from
`utils/routing.ts` while `Authorization.tsx`, `Register.tsx`, and
`App.tsx` each declare their own local copy of the same check?* —
**Unverified** — no comment explains the inconsistency; it's the one
file in this group that reuses the shared utility rather than
duplicating it, which is arguably how all four should be written, but
nothing enforces that consistently across the codebase today.

---

### `src/components/CustomMeasurementsModal.tsx`

**What it is:** The modal for entering custom bust/underbust/waist/hips
(required) plus height/cup/fit-notes (optional) measurements — used
wherever a product supports custom sizing.

**Why it exists:** A self-contained form for a specific, reusable shape
of data (`CustomMeasurements`, from `utils/cartSlice.ts`), decoupled from
whichever parent (a product detail page, `ProductCatalog.tsx`'s modals,
etc. — **unverified** exhaustively which call sites use it in this pass)
needs to collect it.

**What it exports:** `export default function CustomMeasurementsModal({open,
initialValues, onClose, onSubmit})`.

**How it works:** `open` is a boolean prop (this modal stays mounted
and toggles visibility, unlike some others — see Watch out for),
so `useDialogDismiss(overlayRef, contentRef, onClose, open)` is called
with `active={open}` explicitly, matching the hook's own documented
requirement for a component that isn't mount/unmount-driven. A `useEffect`
resets `form` to `normalizeInitial(initialValues)` whenever `open`
becomes true or `initialValues` changes — so reopening the modal for a
different product/line starts from that line's own saved values, not
whatever was left in local state from the last time it was open. A
separate `useEffect` locks `document.body`'s scroll (`overflow: "hidden"`)
while open, restoring the previous value on cleanup. `requiredFilled`
gates the submit button on the four required fields being non-empty
after `.trim()`. Returns `null` entirely when `!open` — meaning the
component *is* in the React tree (its hooks always run, satisfying the
Rules of Hooks) but renders no DOM when closed.

**What it talks to:** `hooks/useDialogDismiss.ts`, `utils/cartSlice.ts`
(the `CustomMeasurements` type only — no direct dispatch; the parent is
responsible for what `onSubmit`'s data actually does, e.g. dispatching
`updateCustomMeasurements`).

**Watch out for:** This is exactly the "stays mounted, toggles `open`"
modal pattern `useDialogDismiss`'s own doc comment calls out as the case
requiring `active={open}` explicitly (as opposed to `ProductModal.tsx`
below, which is conditionally *rendered* by its parent based on
`product` being non-null, and passes `active={!!product}` for the same
reason but a different mechanism — both end up correct, via different
paths).

**Interview question:** *Q: Why does this component return `null` when
`!open` instead of the parent simply not rendering
`<CustomMeasurementsModal />` at all?* — Because it needs `useDialogDismiss`'s
`active` toggle to work correctly across *repeated* open/close cycles for
the *same* mounted instance — if the parent unmounted/remounted the
component instead, every reopen would be a fresh mount, which would also
work with the hook's default `active=true`, but would reset all local
state (including `form`, whose whole point here is to be pre-seeded from
`initialValues` — either approach can work, but this component was
written to expect to stay mounted).

---

### `src/components/ProductModal.tsx`

**What it is:** The size-selection + add-to-cart modal for a single
product — reachable from the Wishlist page's "ADD TO CART" button per
the [[P1-01]] fixes documentation (and possibly elsewhere —
**unverified** exhaustively).

**Why it exists:** Bundles size selection, add-to-cart (for both guest
and authenticated users), and the out-of-stock "NOTIFY ME" subscribe
flow into one self-contained modal.

**What it exports:** `const ProductModal: React.FC<ProductModalProps>`
(`{product: Product | null, onClose}`), default export.

**How it works:**
- **Mount = open**: unlike `CustomMeasurementsModal.tsx`, this component
  is conditionally *rendered* by its parent (`product` is `null` when
  closed), and returns `null` itself when `product` is falsy — so
  `useDialogDismiss(overlayRef, contentRef, onClose, !!product)` passing
  `active={!!product}` is really guarding against the brief render where
  `product` just became `null` but the component hasn't unmounted yet,
  not a genuine stays-mounted-and-toggles pattern.
  the component hasn't unmounted yet)
- **`isAuthed`**: computed once per render as `!!getAccessToken()` — a
  direct token-presence check, not read from Redux `state.auth.isLoggedIn`
  — the file's own comment calls this "a quick auth hint (keeps existing
  behavior unchanged)," i.e. a known simplification rather than an
  oversight.
- **`availableSizes`**: filters `product.sizes` to `quantity > 0`, sorted
  alphabetically by size name — memoized on `product`.
- **`handleAdd`**: branches on `isAuthed`. Authenticated:
  `dispatch(serverCart.addCartItem({product_size_id:
  selectedSizeId})).unwrap()` then `dispatch(serverCart.fetchCart()).unwrap()`
  — re-fetches the whole cart after adding rather than trusting the
  add-response alone, ensuring the header's cart total/count reflects the
  server's authoritative state. Guest: dispatches
  `addToGuestCart({product, product_size_id, sizeName,
  maxQty})` synchronously (no network — the guest cart is local). Either
  path closes the modal on success. On failure: `console.error` **and** a
  native `alert("Could not add to cart.")` — the file's own comment flags
  this directly: "Keeping alert to avoid changing UX flow; swap to toast
  later if needed" — a known, deliberate use of the browser's blocking
  `alert()`, matching audit item P3-15 ("the only such place in the
  app").
- **`handleNotifyMe`**: no-ops immediately if `!isAuthed` — the code
  comment explains why at length: this modal has no email input field
  (unlike `ProductCatalog.tsx`'s own notify flow, which collects one for
  guests), so an unauthenticated call would have no way to identify who
  to notify, and rather than send an unidentifiable request, it mirrors
  `ProductCatalog`'s own guard and does nothing. For an authenticated
  user: `POST /products/{id}/subscribe_back_in_stock/` with no body (the
  backend takes the subscriber's email from `request.user` server-side).
  Success sets `notifyDone` for 2.5s (button reads "SUBSCRIBED"); failure
  sets `notifyError` for 2.5s (button reads "TRY AGAIN") instead of
  silently showing "SUBSCRIBED" regardless of outcome — this
  success/failure distinction is exactly the [[P1-01]] fix; before it,
  this handler was a stub that always showed "SUBSCRIBED" without any
  request at all.

**What it talks to:** `api/axiosInstance.ts` (the notify-me POST),
`store/serverCartSlice.ts` (`addCartItem`, `fetchCart`), `utils/cartSlice.ts`
(`addToCart` as `addToGuestCart`), `types/token.ts` (`getAccessToken`),
`hooks/useDialogDismiss.ts`. Backend: `POST /products/cart/items/` (via
the thunk), `POST /products/{id}/subscribe_back_in_stock/`.

**Watch out for:** `isAuthed` is computed via a direct `getAccessToken()`
call rather than a Redux selector — it's read once per render (not
reactive to a Redux `isLoggedIn` change without a re-render being
triggered by something else), which the code explicitly acknowledges as
a deliberate simplification rather than treating it as a bug to fix here.

**Interview questions:**
- *Q: Why does `handleAdd`'s authenticated branch call `fetchCart()`
  after `addCartItem()`, when `addCartItem`'s own fulfilled reducer
  already updates `state.serverCart.cart.items` with the new item?* —
  Belt-and-suspenders: the reducer update is locally correct for the one
  item just added, but re-fetching the whole cart also picks up anything
  server-side that a single-item response wouldn't reflect (e.g. a
  price/stock recalculation elsewhere in the cart, if the backend does
  any such thing on item add — **unverified** whether it actually does;
  the pattern is defensive regardless).
- *Q: Why does `handleNotifyMe` silently no-op for a guest instead of
  showing an error?* — Because, per the component's own comment, this
  modal has no email field to identify a guest subscriber with, and this
  modal is only reachable while authenticated in practice (via the
  Wishlist page) — so the guest branch is a defensive guard against a
  theoretical call path rather than a real, reachable user flow that
  needs its own error messaging.
- **Harder follow-up:** *Q: If `isAuthed` were changed to read from a
  Redux selector instead of `getAccessToken()` directly, what would have
  to also change for the modal to behave correctly?* — Nothing else
  structurally — `useAppSelector((s) => s.auth.isLoggedIn)` would make it
  reactive to logout happening *while the modal is open* (currently, if a
  401 elsewhere triggers `logout()` while this modal is open, `isAuthed`
  here wouldn't update until the next render for an unrelated reason),
  but every consumer of `isAuthed` in this file (`handleAdd`,
  `handleNotifyMe`) would keep working unchanged, since both just branch
  on the boolean.

---

### `src/components/cookies/cookiePreferences.ts`

**What it is:** The cookie-consent storage layer — the single source of
truth for what a visitor has (or hasn't) consented to, read by
`CookieConsent.tsx`, `CookieSettingsModal.tsx`, `metaPixel.ts`,
`tiktokPixel.ts`, and `pixelLoader.ts`.

**Why it exists:** Every consent-gated feature in the app (marketing
pixels, and potentially analytics — see Watch out for) needs one
authoritative place to read "has this visitor consented, and to what,"
persisted across visits.

**What it exports:** `CookieConsentPreferences` (`{necessary: true,
analytics: boolean, marketing: boolean}` — `necessary` is typed as the
literal `true`, not `boolean`, since it's never actually a user choice),
`defaultCookieConsent` (`{necessary: true, analytics: false, marketing:
false}`), `getCookieConsent()`, `saveCookieConsent(preferences)`,
`acceptAllCookies()`, `rejectOptionalCookies()`.

**How it works:** Everything is `localStorage`-backed under
`STORAGE_KEY = "tresse_cookie_consent_v1"` (the `_v1` suffix implies room
for a future migration if the stored shape ever needs to change).
`getCookieConsent()` parses the stored JSON defensively — any parse
failure or missing value returns `null` (meaning "no choice recorded
yet," distinct from an explicit reject), and even a successfully parsed
value has `analytics`/`marketing` re-coerced through `Boolean(...)`
rather than trusted as already being the right type. `saveCookieConsent`
always writes `necessary: true` regardless of what's passed (it's not
actually optional, despite being part of the type) plus a `savedAt`
ISO-timestamp field (**unverified** whether anything reads `savedAt`
back — it may exist purely for a human debugging `localStorage` by hand,
or for a future consent-expiry feature) — and, critically, **every**
save dispatches `window.dispatchEvent(new CustomEvent("tresse:cookieConsentUpdated"))`,
which is the single mechanism `pixelLoader.ts` listens for to react to a
consent change live, in the same session, without a page reload.
`acceptAllCookies()`/`rejectOptionalCookies()` are just `saveCookieConsent`
called with hardcoded preference objects.

**What it talks to:** `localStorage` (`tresse_cookie_consent_v1`),
`window` (dispatches `"tresse:cookieConsentUpdated"`, listened to by
`utils/pixelLoader.ts`).

**Watch out for:** `analytics` consent is tracked and persisted here, and
`CookieSettingsModal.tsx` lets a visitor toggle it independently from
`marketing` — but no file this pass has read (`metaPixel.ts`,
`tiktokPixel.ts`, `pixelLoader.ts`) ever checks `.analytics` for
anything; only `.marketing` gates the pixel system. **Unverified**
whether any analytics tool (Google Analytics or similar) is wired up
elsewhere in the app and gated on this flag — if not, the "Analytics
Cookies" toggle in the settings modal currently controls a preference
that nothing in the read-through of this codebase actually consults.

**Interview questions:**
- *Q: Why does `getCookieConsent()` return `null` for "no choice yet"
  instead of a default `{marketing: false, ...}` object?* — So callers
  like `CookieConsent.tsx` can distinguish "never asked" (show the
  banner) from "asked and explicitly rejected optional cookies" (don't
  show the banner, keep marketing off) — collapsing both into the same
  default object would make the banner never reappear for a first-time
  visitor, or would make an explicit rejection indistinguishable from
  having never been asked.
- *Q: Why is every save funneled through one `saveCookieConsent`
  function rather than each caller writing to `localStorage` directly?*
  — So the `"tresse:cookieConsentUpdated"` event — the mechanism
  `pixelLoader.ts` depends on entirely for reacting to a consent change
  without a page reload — can never be forgotten at a new call site; it's
  structurally impossible to update consent without also firing the
  event.

---

### `src/components/cookies/CookieConsent.tsx`

**What it is:** The cookie banner itself — the first UI a new visitor
sees, per the fixes documentation's own framing of why its dialog
behavior mattered enough to fix ([[P1-14]]).

**Why it exists:** Owns the top-level "have we recorded a consent
choice yet" decision and renders either the banner, the settings modal,
or nothing.

**What it exports:** `export default function CookieConsent()`. Rendered
once from `App.tsx`, outside the `<Routes>` (so it appears identically on
every page, not tied to any one route).

**How it works:** On mount, reads `getCookieConsent()`. If a saved
preference exists, adopts it into local `preferences` state and keeps
the banner hidden (`visible: false`); if not, shows the banner
(`visible: true`). Three handlers: `handleAcceptAll` /
`handleRejectOptional` call the corresponding `cookiePreferences.ts`
function and hide the banner; `handleSavePreferences` (passed to
`CookieSettingsModal` as `onSave`) calls the generic `saveCookieConsent`
with whatever the modal collected, and closes **both** the modal and the
banner (`setSettingsOpen(false)` and `setVisible(false)`) — so opening
"Cookie Settings" from the banner and saving there dismisses the banner
too, not just the modal. Renders `null` entirely when neither `visible`
nor `settingsOpen` is true — no persistent trace in the DOM once a choice
has been made and no modal is open.

**What it talks to:** `components/cookies/CookieSettingsModal.tsx`
(renders it conditionally), `components/cookies/cookiePreferences.ts`
(the full read/write API), `react-router-dom` (`Link` to the Cookie
Policy page).

**Watch out for:** The initial `getCookieConsent()` read happens in a
`useEffect` (after the first render), not synchronously during render —
so on a fresh mount, there's a first render where `visible` is still
`false` (its `useState` initial value) before the effect runs and
potentially flips it to `true`. In practice this is invisible to a user
(effects run before the browser paints in the common case, and there's
no other content that would be visible in that gap), but it does mean
this component isn't rendering purely from `localStorage` on the very
first pass.

**Interview question:** *Q: Why does saving from the settings modal
dismiss the top-level banner too, rather than just closing the modal and
leaving the banner state untouched?* — Because reaching the settings
modal from the banner and clicking "Save Preferences" **is** making a
consent choice — the same as "Accept All"/"Reject Optional" — so the
banner (whose entire purpose is prompting for a not-yet-made choice) has
no reason to still be visible afterward; leaving it up would ask the same
visitor to choose again immediately after they just did.

---

### `src/components/cookies/CookieSettingsModal.tsx`

**What it is:** The granular cookie-preferences dialog (Analytics /
Marketing toggles, Necessary always-on) — reachable from the banner's
"Cookie Settings" button.

**Why it exists:** Lets a visitor make a more specific choice than the
banner's blunt Accept All / Reject Optional buttons.

**What it exports:** `export default function CookieSettingsModal({initialPreferences,
onClose, onSave})`.

**How it works:** Local `analytics`/`marketing` boolean state, seeded
from `initialPreferences` at mount (no effect re-syncing them if
`initialPreferences` changes after mount — this component is only ever
rendered while `CookieConsent.tsx`'s `settingsOpen` is true, i.e. it
mounts fresh each time it opens, so there's no "already-open modal whose
props changed underneath it" case to handle). `useDialogDismiss(overlayRef,
contentRef, onClose)` — called with the default `active = true`, correct
here because, like `ProductModal.tsx`, this component is only ever
mounted while open (`CookieConsent.tsx` conditionally renders it, it
doesn't toggle a prop on an always-mounted instance). A second `useEffect`
(no dependency array, empty deps `[]`) locks `document.body`'s scroll for
as long as the modal is mounted, restoring the previous value on
unmount. "Save Preferences" calls `onSave({necessary: true, analytics,
marketing})` — the caller (`CookieConsent.tsx`) is responsible for
persisting it via `saveCookieConsent`; this component never touches
`localStorage` or the consent-update event itself.

**What it talks to:** `hooks/useDialogDismiss.ts`,
`components/cookies/cookiePreferences.ts` (`CookieConsentPreferences`
type only — no direct read/write; `onSave`'s caller does that).

**Watch out for — this is the file the [[P1-14]] fix changed, and it's
worth knowing exactly what was different before:** per the fixes
documentation, this modal previously had **none** of the
`useDialogDismiss` behavior — no Escape-to-close, no focus moved in on
open, no focus restored on close, no overlay-click close, no scroll
lock — and its overlay carried `role="presentation"`, which
misrepresented an element that (once wired to the hook) genuinely does
close the dialog on click. The monkey-test log referenced in the fixes
documentation showed the concrete impact directly: after opening "Cookie
Settings," several consecutive clicks timed out because the overlay
silently swallowed every event, and the modal only went away via a
forced navigation. The current file — read directly here — has none of
those gaps: `useDialogDismiss` is wired up exactly like
`CustomMeasurementsModal.tsx`, and `role="presentation"` is gone from the
overlay `<div>`.

**Interview questions:**
- *Q: Why is this the very first modal a new visitor is likely to
  encounter, and why did that make its missing dialog behavior worse than
  the same gap in, say, a product-customization modal deep in the
  checkout flow?* — It's rendered unconditionally on every page via
  `CookieConsent.tsx` in `App.tsx`, outside any route, so it's often the
  first interactive element on the site at all — a keyboard or
  assistive-tech user who got stuck on it (no Escape, no way to
  Tab/click out) would be stuck on literally the first screen, before
  ever reaching the actual site content.
- *Q: Why does this component use the hook's default `active = true`
  instead of passing `active={true}` explicitly or wiring up an `open`
  prop the way `CustomMeasurementsModal.tsx` does?* — Because
  `CookieConsent.tsx` only ever renders `<CookieSettingsModal />` while
  `settingsOpen` is true (conditional mounting, not a toggled prop on an
  always-mounted instance) — the default is already correct for this
  usage pattern, so there's no need for an explicit `open` prop the way a
  stays-mounted modal like `CustomMeasurementsModal.tsx` needs.

---

### `src/components/cookies/CookieSettingsModal.test.tsx`

**What it mocks:** Nothing — renders the real component directly (no
`CookieConsent.tsx` wrapper), resetting `document.body.style.overflow`
in `beforeEach` so the scroll-lock side effect from one test can't leak
into the next.

**What it asserts:** Dismissal group — Escape calls `onClose`; a
`mousedown` on `.cookieModalOverlay` calls `onClose`; a `mousedown`
inside the dialog (`role="dialog"`) does not; focus moves into the
dialog on mount (all four are the direct regression coverage for the
[[P1-14]] fix — before it, none of these would have passed). Saving
group: clicking both checkboxes then "Save Preferences" calls `onSave`
with `{necessary: true, analytics: true, marketing: true}`; saving
without touching anything calls `onSave` with the `initialPreferences`
passed in unchanged (proving the form correctly seeds from props rather
than always defaulting to some hardcoded starting state).

**Interview question:** *Q: This test file never mocks
`useDialogDismiss` — why is that a meaningful choice here, given how much
dialog-behavior logic lives inside that hook rather than in this
component?* — Because the point of these specific tests **is** to verify
the hook is correctly wired into this particular component (the right
refs passed, `onClose` actually connected, focus landing in the right
place) — mocking the hook away would make the tests assert nothing about
whether the wiring itself is correct, only that the component calls a
function named `useDialogDismiss`, which `useDialogDismiss.test.tsx`
already covers for the hook's own internal logic in isolation.

---

### Auth-flow component tests, as a group (`Authorization.test.tsx`, `Register.test.tsx`, `AccountRestore.test.tsx`, `PasswordChange.test.tsx`, `PasswordResetConfirm.test.tsx`)

**What they mock, in common:** `../api/axiosInstance` (all four HTTP
methods stubbed), and — for `Authorization.test.tsx`/`Register.test.tsx`
specifically — `../types/token` entirely and `react-router-dom`'s
`useNavigate` (replaced with a `vi.fn()` spy, real router otherwise, via
`vi.importActual`). `Authorization.test.tsx`/`Register.test.tsx` also
build a real `configureStore` with all four real reducers rather than
mocking Redux away, so `setCredentials`/`mergeGuestCart`/`fetchCart`
genuinely run against real reducer logic — only the network layer
underneath them is mocked.

**What they assert, by file:**
- **`Authorization.test.tsx`** / **`Register.test.tsx`**: required-field
  and format validation errors (empty fields, invalid email, weak
  password, malformed phone for Register); successful submission
  navigates to `/` (or a safe `?next=` target — both files independently
  test the open-redirect protection with a `//evil.com` value,
  confirming it collapses to `/`); a response missing `access`/`user`
  shows a generic failure message without navigating; a rejected
  `loginUser`/`registerUser` call surfaces its `Error.message` directly
  (with an inline comment on the login side explaining that
  `api/auth.ts` already unwraps any `AxiosError`, so the `isAxiosError`
  branch in the component's own error-message function rarely actually
  runs); a failing `mergeGuestCart`/`fetchCart` doesn't block navigation
  or show an error — the direct regression test for [[P1-13]] on the
  Register side, and the confirmation that `Authorization.tsx` already
  had this behavior on the login side.
- **`AccountRestore.test.tsx`** / **`PasswordResetConfirm.test.tsx`**:
  missing URL params show an invalid-link state (a full alternate view
  for restore; a disabled-but-visible form plus an alert for reset
  confirm — matching each component's own different choice, both
  correctly asserted against); client-side length/match validation
  blocks submission before any request; a successful submit sends the
  exact expected payload, shows a success message, and — using
  `vi.useFakeTimers()` and `vi.advanceTimersByTimeAsync(...)` to
  deterministically fast-forward past the component's own
  `setTimeout`/`window.setTimeout` delay — navigates after the expected
  delay; a rejected request surfaces the server's message.
- **`PasswordChange.test.tsx`**: renders the three fields and button;
  client-side validation (short password, mismatch) blocks the request;
  a successful submit sends the exact payload and clears all three
  fields; a rejected request surfaces either a `detail` message or a
  field-specific one (`current_password: [...]`) depending on what the
  mocked response shape provides.

**Interview question:** *Q: Why do `AccountRestore.test.tsx` and
`PasswordResetConfirm.test.tsx` use `vi.useFakeTimers()` with
`vi.advanceTimersByTimeAsync(...)`, rather than just `waitFor(...)`
around the real `setTimeout` delay?* — `waitFor` alone would work but
would make the test actually wait out the real 600ms/900ms delay (slow,
and technically flaky under load); fake timers let the test assert the
success message appears immediately, then deterministically fast-forward
exactly past the component's own delay before asserting the navigation
happened — faster and not dependent on real wall-clock timing.

---

## `view/`

The routed pages proper — everything `App.tsx`'s route table points at
that isn't one of the auth-flow forms already covered under
`components/`. This is the largest folder in the app and carries most of
the real product/cart/order business logic. Organized here roughly by
weight: the shopping-flow pages first (Cart, Order, OrderHistory,
ProductCatalog, ProductDetails, WishList, Dashboard — the ones named
explicitly as worth full depth), then the smaller content/marketing
pages as a lighter-touch group, then the test files as a group per the
same pattern used for `components/`.

### `src/view/Cart.tsx`

**What it is:** The shopping-cart page — the one view that has to
reconcile the guest cart (`utils/cartSlice.ts`) and the server cart
(`store/serverCartSlice.ts`) into a single UI, since a visitor can arrive
here either logged in or as a guest, and can transition from one to the
other while the page is open.

**Why it exists:** Owns cart display, quantity/measurement editing, item
removal, and the transition into checkout, for both auth states behind
one URL (`/cart`) rather than splitting into a guest-cart page and a
separate server-cart page.

**What it exports:** `export default function Cart()`. Routed at
`/cart` (public — no `PrivateRoute`, since a guest must be able to use
the cart).

**How it works:**
- **`isAuthed`** is computed via `Boolean(localStorage.getItem("access"))`
  directly — a **third** distinct place in the codebase reading the raw
  `"access"` key rather than either `types/token.ts`'s `getAccessToken()`
  or a Redux `state.auth.isLoggedIn` selector (alongside `ProductModal.tsx`'s
  `getAccessToken()` call and the several `isSafePath` copies elsewhere)
  — another instance of the same auth-state-read-many-different-ways
  pattern recurring across the codebase.
- **`usingServer`**: `isAuthed && (hasServer || !hasGuest)` — an
  authenticated user with a genuinely empty guest cart is shown the
  (possibly also empty) server cart rather than an empty guest cart, but
  an authenticated user who still has unmerged guest items and no server
  items yet sees the guest cart until the merge effect (below) runs and
  populates the server cart.
- **Three independent `useEffect`s handle three different concerns**:
  (1) fetch the server cart whenever `isAuthed` — runs on every mount for
  a logged-in user, not just once; (2) merge the guest cart into the
  server cart, gated by a `didMergeRef` ref so it only ever fires once
  per mount even though `isAuthed`/`hasGuest` could theoretically
  re-trigger the effect — dispatches `mergeGuestCart()` then `fetchCart()`
  sequentially, swallowing any failure (`catch { /* keep guest cart */ }`,
  matching [[P1-12]]'s per-line removal so a partial failure leaves only
  the failed lines behind for a future merge attempt); (3) a completely
  separate "Meta cart import" feature (see below).
- **The Meta cart import feature** (`META_PRODUCT_MAP`,
  `parseMetaProducts`, the third `useEffect`): parses a `?products=`
  query param shaped like `metaId:qty,metaId2:qty2` (the format Meta/
  Facebook's dynamic-ads "View in cart" links use), maps each `metaId`
  through a small hardcoded lookup table (`{"96arxjauw2": 104}` — one
  entry, a specific ad campaign's product mapped to this site's internal
  product id 104) to a real product id, fetches that product, picks its
  first in-stock size, and adds it to whichever cart (guest or server)
  applies — looping `metaItem.quantity` times, calling the add-to-cart
  path once per unit rather than passing a quantity. Guarded by
  `didHandleMetaCartRef` so it only runs once per mount, and finishes by
  navigating to `/cart` with `replace: true` to strip the `?products=`
  param from the URL once the import is done. This entire feature exists
  to make a Meta ad's "add these items to cart" deep link work when it
  lands a visitor on this page — **unverified** whether campaign
  `96arxjauw2` is still active; the mapping table would need a new entry
  for any other campaign.
- **`total`, `hasMissingRequiredMeasurements`**: both `useMemo`d,
  branching on `usingServer` to read from `serverItems` or `guestItems` —
  the same "which cart is authoritative right now" branch repeated
  throughout the component (also in the render itself, in
  `handleQuantityChange`, `handleRemove`, `handleSaveMeasurements`).
- **`getServerUnitPrice`/`getGuestUnitPrice`**: base price plus custom-length
  surcharge (only when `custom_length_selected` is true) — the same
  price-composition logic `Order.tsx` and `ProductDetails.tsx` each also
  implement independently (see Watch out for).
- **`onPay`**: blocked entirely if `hasMissingRequiredMeasurements`;
  redirects an unauthenticated user to
  `/login-choice?next=%2Forder` rather than letting them proceed to
  `/order` as a guest — checkout requires an account.

**What it talks to:** `api/axiosInstance.ts` (only for the Meta-cart
product lookup, `GET /products/{id}/`), `store/serverCartSlice.ts` (the
full thunk set), `utils/cartSlice.ts` (`addToCart`, `removeFromCart`,
`updateQuantity`, `updateCustomMeasurements`, `selectGuestCartItems`),
`components/CustomMeasurementsModal.tsx`. Backend: `GET /products/cart/`,
`POST /products/cart/items/`, `PUT /products/cart/items/<id>/`, `DELETE
/products/cart/items/<id>/`, `GET /products/{id}/` (Meta import only).

**Watch out for:**
- **Price-composition logic (base price + conditional custom-length
  surcharge) is implemented independently in at least three files**
  (`Cart.tsx`'s `getServerUnitPrice`/`getGuestUnitPrice`, `Order.tsx`'s
  inline calculation in `cartLines`, and `ProductDetails.tsx`'s
  `displayPrice`) rather than through one shared helper — a change to the
  pricing rule (e.g. how the surcharge interacts with a future discount)
  would need to be made correctly in every one of these places
  independently.
- The Meta cart import feature has no test coverage in `Cart.test.tsx`
  (confirmed by reading the test file — no test references `?products=`
  or `META_PRODUCT_MAP`), and is easy to miss entirely on a first read of
  this file, since it's unrelated to the cart's primary purpose and
  triggered only by a specific query param.
- `didMergeRef`/`didHandleMetaCartRef` are both plain refs used purely as
  "has this already run once" guards, not for anything DOM-related — a
  common pattern for "run this side effect exactly once per mount" that
  doesn't fit cleanly into a dependency array.

**Interview questions:**
- *Q: Why does the guest-cart merge effect use a ref guard
  (`didMergeRef`) instead of an empty dependency array (`useEffect(...,
  [])`)?* — The effect's *condition* to actually do anything depends on
  `isAuthed`/`hasGuest`, which aren't known synchronously at mount (auth
  state and the guest cart are both already-loaded Redux state here, so
  arguably they are — but the effect still needs to react if either
  changes shortly after mount without re-running the merge a second time
  once it's already happened) — the ref guard decouples "when should this
  effect's dependencies be checked" from "should the merge actually run
  again," which an empty array alone can't express if the effect needs
  to react to a value becoming true after mount at all.
- *Q: What would happen to the guest cart's contents if the merge effect
  didn't swallow `mergeGuestCart()`'s rejection?* — Nothing different in
  terms of data loss — `mergeGuestCart` itself (in
  `serverCartSlice.ts`) already handles partial failure internally,
  removing only the successfully-merged lines — but an unswallowed
  rejection here would propagate as an unhandled promise rejection from
  this component's effect, which is why the `catch` exists: to contain
  the effect's own async work rather than to protect data that's already
  protected one layer down.
- **Harder follow-up:** *Q: Trace what happens if a guest with items in
  their cart clicks a Meta ad link containing `?products=96arxjauw2:2`
  while already logged in with items already in their server cart.* — A:
  On mount, the fetch-server-cart effect fires first (fetches the
  existing server cart). The merge effect sees `hasGuest` true (if the
  guest also has local items) and merges those in. Independently, the
  Meta-import effect parses the query param, looks up `96arxjauw2` →
  product 104, fetches that product, finds its first in-stock size, and
  — since `isAuthed` is true — calls `dispatch(serverCart.addCartItem(...)).unwrap()`
  twice (once per unit of quantity 2), then `fetchCart()`, then navigates
  to `/cart` with the query param stripped. All three effects can be
  in-flight concurrently since none of them wait on each other; the final
  server cart state reflects whichever `fetchCart()` call resolves last
  overwriting the Redux `cart` state with its own snapshot — a latent
  potential for the very last `fetchCart()` in flight to "win" regardless
  of which operation actually finished writing to the server most
  recently, though since all three effects's mutations eventually settle
  before their own explicit `fetchCart()` call, this is very unlikely to
  visibly race in practice.

---

### `src/view/Order.tsx`

**What it is:** The checkout page — order summary, the first-order promo
code, return-policy/final-sale consent checkboxes, and the handoff to
Stripe Checkout.

**Why it exists:** The last step before payment: shows what's about to
be charged, collects the two consent checkboxes the backend's webhook
later records against the order (`policy_accepted`,
`custom_size_final_sale_acknowledged`), and creates the Stripe Checkout
Session.

**What it exports:** `export default function Order()`. Routed at
`/order`, behind `PrivateRoute`, wrapped by `App.tsx`'s
`OrderRouteWithStripe` (which lazy-loads `@stripe/stripe-js` and wraps
this component in `<Elements>` — see the Entry point section's note on
`App.tsx`).

**How it works:**
- Fetches the server cart on mount (`dispatch(serverCart.fetchCart())`)
  — this page only ever operates on the **server** cart; there's no
  guest-checkout path here at all (consistent with `PrivateRoute`
  gating this route).
- **First-order promo check**: a separate effect calls `GET /orders/my/`
  and checks whether any returned order has `status === "paid"`
  (case/whitespace-normalized) — `isFirstOrder` is `true` only once this
  resolves and finds none. On any request failure, it defaults to
  `isFirstOrder: false` (fail closed — don't show a promo code to
  someone whose order history couldn't be confirmed as empty). This is
  the exact endpoint the [[P1-02]] fix corrected (the pre-fix code called
  a `/orders/my-orders/` path that didn't exist, so `isFirstOrder` was
  always `false` and the promo never showed).
- **`cartLines`**: maps each server cart item into a display-ready shape,
  computing `price = basePrice + customLengthSurcharge` inline — its own
  independent copy of the same surcharge-composition logic `Cart.tsx` and
  `ProductDetails.tsx` each implement separately (see `Cart.tsx`'s Watch
  out for).
- **`hasCustomItems`**: `hasCustomSizedItems || hasCustomLengthItems` —
  drives whether the second consent checkbox (final-sale acknowledgement)
  even renders at all.
- **`handleCopyPromo`**: `navigator.clipboard.writeText(...)`, shows
  "Copied" for 1.8s; silently no-ops (stays un-copied) if the Clipboard
  API throws (e.g. denied permission, insecure context).
- **`handleCheckout`**: validates both consent checkboxes locally first
  (sets field-specific error text, refuses to proceed on either being
  missing) *before* calling `trackTikTok("InitiateCheckout", ...)` and
  `POST /orders/create-checkout-session/` with
  `{policy_accepted, custom_size_final_sale_acknowledged}`. On success,
  `window.location.assign(data.url)` — a full page navigation to Stripe's
  hosted checkout page, not a client-side route change; the backend's
  `checkout.session.completed` webhook (not this component) is what
  actually creates the `Order` row once payment completes. On failure,
  reads `error.response.data.detail` for a specific message (e.g. a
  stock-shortage message from the backend) or falls back to a generic
  "Checkout could not be prepared" string.

**What it talks to:** `api/axiosInstance.ts` (`GET /orders/my/`, `POST
/orders/create-checkout-session/`), `store/serverCartSlice.ts`
(`fetchCart` only — no add/update/remove happens on this page),
`utils/tiktokPixel.ts` (`trackTikTok`), `navigator.clipboard`,
`window.location.assign`. Backend: `MyOrdersAPIView`
(`GET /orders/my/`), `create_checkout_session`
(`POST /orders/create-checkout-session/`, `orders/views_stripe.py`).

**Watch out for:**
- **`isFirstOrder === null` (the initial state, before the `/orders/my/`
  check resolves) is treated identically to `false` for rendering
  purposes** — the promo box's condition is
  `!cartIsEmpty && isFirstOrder === true`, so nothing renders until the
  check explicitly resolves `true`; there's no separate loading state for
  the promo box itself, just its absence until proven eligible.
- The `WELCOME_PROMO_CODE` constant (`"TRESSE15"`) is hardcoded here on
  the frontend, purely for display/copy purposes — the backend's Stripe
  Checkout Session sets `allow_promotion_codes: true` and the customer
  types the code into Stripe's own hosted checkout UI; this component
  never sends the code anywhere itself, it only shows and copies it.
- `handleCheckout`'s error handling reads
  `error.response?.data?.detail` directly with no `isAxiosError` guard
  or extraction-priority ladder (unlike `api/auth.ts`'s
  `getErrorMessage` or `utils/newsletter.ts`'s
  `extractBestErrorMessage`) — a simpler, less defensive pattern than
  several other error-handling call sites in this codebase, though
  sufficient for the one error shape this endpoint is documented to
  return.

**Interview questions:**
- *Q: Why does the promo-code check call a separate `/orders/my/`
  endpoint instead of deriving "is this a first order" from something
  already available on the cart or user object?* — Because "has this
  user ever had a paid order" is order-history state, not cart or
  session state — the cart being fetched on this page has no relationship
  to past orders, so answering the question requires its own request
  against the order-history endpoint.
- *Q: What does `handleCheckout` guarantee about `policy_accepted` and
  `custom_size_final_sale_acknowledged` by the time the checkout-session
  request is sent?* — Both are validated with early returns
  (`hasConsentError`) before the request fires at all — the second is
  only actually required when `hasCustomItems` is true, but its state is
  sent regardless (`hasCustomItems ? customFinalSaleAccepted : false`),
  so the backend always receives an explicit boolean for both fields, not
  an omitted one.
- **Harder follow-up:** *Q: If Stripe's `success_url` redirect landed the
  browser back on `/order` instead of `/order/success` for some reason,
  what would this component do?* — Nothing special — it has no awareness
  of a post-payment state at all; it would just refetch the (now
  presumably empty, since the order-creating webhook clears the cart
  server-side once the `Order` is created — **unverified** whether the
  cart is explicitly cleared or simply reflects no items because they
  were moved to the order; would need to read `views_stripe.py`'s webhook
  handler directly to confirm) cart and render as if starting a fresh
  checkout. The actual post-payment experience relies entirely on Stripe
  redirecting to the distinct `/order/success` route
  (`view/OrderSuccess.tsx`), which this component has no knowledge of.

---

### `src/view/OrderHistory.tsx`

**What it is:** The "My Orders" page — order list, status badges,
tracking info, and the cancel/return actions. **This file's return-flow
logic was rewritten as part of the work this guide's own project
covers** — see [[P1-05]]/[[P1-06]] in the fixes documentation; the
description below reflects the current, post-fix code.

**Why it exists:** One page covering everything a customer needs to see
about past orders: status, payment method, shipping/tracking, and the
two self-service actions (cancel within 24 hours, return within 14 days
of delivery) the backend's `CancelOrderAPIView`/`RequestReturnAPIView`
expose.

**What it exports:** `export default function OrderHistory()`. Routed at
`/orders`, behind `PrivateRoute`.

**How it works:**
- Fetches `GET /orders/my/` once on mount, populating a flat `orders`
  array — no pagination (this endpoint isn't paginated on the backend
  either, per `MyOrdersAPIView`).
- **A `now` tick, refreshed every 60 seconds** (`CLOCK_REFRESH_MS`) via
  `setInterval`, is what drives both `isCancelable` and `isReturnable`'s
  window checks — without it, a page left open past the 24-hour cancel
  or 14-day return boundary would keep showing the action button until
  the next full page reload, since neither window check would otherwise
  ever re-evaluate.
- **`isCancelable(order)`**: `status === "paid"` and `now - createdAt`
  within `CANCEL_WINDOW_MS` (24 hours) — counted from `created_at`,
  correctly, since the backend's `CancelOrderAPIView` also counts the
  cancel window from order creation, not delivery.
- **`isReturnable(order)`**: `status === "paid"`, no existing
  `return_status`, a non-empty/parseable `delivered_at`, and
  `now - deliveredAt` within `RETURN_WINDOW_MS` (14 days) — counted from
  **delivery**, matching `RequestReturnAPIView`'s own window (which
  requires a non-empty `delivered_at` and counts 14 days from it) —
  this is the corrected version of the [[P1-06]] bug, where the
  pre-fix code counted 14 days from `created_at` instead, so the button
  could disappear before a slow-to-produce, slow-to-ship order had even
  arrived.
- **`cancelOrder(orderId)`**: `POST /orders/{id}/cancel/`, replaces the
  matching order in local state with the response body (the backend
  returns the updated order) rather than refetching the whole list.
- **`requestReturn(orderId)`**: gated by `window.confirm(...)` first (a
  native confirm dialog, not a custom modal) — declining posts nothing.
  On confirm, `POST /orders/{id}/return/`, same in-place replace-by-id
  pattern as cancel. On failure, extracts `error.response.data.detail`
  (via `isAxiosError`) for the backend's specific rejection reason (e.g.
  "Custom-sized items are final sale.", "Return window has expired") or
  falls back to a generic message. This entirely replaces the pre-fix
  `goToReturns`, which just navigated to `/help?topic=return&order=...` —
  a URL `Help.tsx` never actually read.
- Both `cancelOrder` and `requestReturn` use **separate** busy-state
  variables (`busyId` for cancel, `returningId` for return) rather than
  one shared one, specifically so triggering a return on one order
  doesn't disable/relabel the Cancel button text on a different order (or
  vice versa) while the other request is in flight.
- Renders a "Return: `<status label>`" field on the order card once
  `order.return_status` is set (mapped through `RETURN_STATUS_LABELS`,
  e.g. `"requested"` → `"Requested"`, `"refund_pending"` → `"Refund
  pending"`), and the Return button itself disappears once a
  `return_status` exists (a repeat return request would be rejected by
  the backend anyway; hiding the button avoids the round trip).

**What it talks to:** `api/axiosInstance.ts` (`GET /orders/my/`, `POST
/orders/{id}/cancel/`, `POST /orders/{id}/return/`),
`window.confirm`, `window.setInterval`. Backend: `MyOrdersAPIView`,
`CancelOrderAPIView`, `RequestReturnAPIView` (all `orders/views.py`).

**Watch out for:** The 60-second clock tick means `isCancelable`/
`isReturnable` are recomputed (and the whole order list re-rendered) on
every tick even if nothing about the underlying orders changed — a
deliberate trade of a cheap periodic re-render for correctness of the
time-window buttons without requiring a manual page refresh.

**Interview questions:**
- *Q: Why does `isReturnable` check `!order.return_status` in addition
  to the delivery-date window?* — Once a return has been requested, the
  backend refuses a second request for the same order
  (`RequestReturnAPIView` returns 400 "A return request already exists
  for this order") — hiding the button once `return_status` is set
  avoids showing an action that would just fail, and the "Return:
  Requested" status field takes its place.
- *Q: Why is the return action confirmed with a native `window.confirm`
  instead of a custom modal, when the rest of the app has a whole
  dialog-behavior system (`useDialogDismiss`)?* — **Unverified** from the
  code alone — likely a pragmatic choice for a single yes/no confirmation
  with no form fields, where a custom modal would add complexity (focus
  trap, Escape handling, etc.) for no functional benefit over the native
  dialog, which already handles all of that itself; every other modal in
  this codebase collects actual input or shows richer content than a
  single confirmation.
- **Harder follow-up:** *Q: What's the concrete, observable consequence
  of `RETURN_WINDOW_MS` being computed from `delivered_at` instead of
  `created_at`, for an order that took three weeks total (two weeks
  production, one week transit)?* — Under the old (pre-fix) `created_at`-based
  logic, the 14-day return window would have already expired by the time
  the customer received the item — the button would never appear at all
  for a normally-paced order. Under the current `delivered_at`-based
  logic, the customer gets a full 14 days starting from when they
  actually have the item in hand, matching the Return Policy page's own
  stated terms and the backend's own enforcement.

---

### `src/view/ProductCatalog.tsx`

**What it is:** The catalog/browse page — filtering, sorting, the
product grid, and four locally-defined modal components
(`NotifyModal`, `SizeModal`, `CustomLengthModal`, `ComingSoonModal`) that
exist only inside this file rather than in `components/`.

**Why it exists:** The single largest page in the app by responsibility:
server-side filtering/search/sort with debounced requests, client-side
pagination flattening (fetches every page up front rather than paginating
the UI), wishlist toggling inline on each card, and a multi-step
add-to-cart flow (size selection → optional custom-length choice →
optional custom-measurements collection) that can branch through up to
three of its own modals depending on the product.

**What it exports:** `export default function ProductCatalog()`. Routed
at `/catalog`.

**How it works:**
- **Filters are read from and written to the URL** (`readFilters`,
  `location.search`), not just local component state — `category`/
  `collection` come from `?category=`/`?collection=` and are normalized
  through `normalizeCategory`/`normalizeCollection` (each accepting
  several spelling variants — `"women"`, `"woman"`, `"womens"`,
  `"female"` all resolve to the same `"woman"` key — a lenient parser for
  links that might use any of these). `searchTerm`, `ordering`,
  `minPrice`, `maxPrice` are local state only, not URL-synced (only the
  initial `searchTerm` seeds from `?search=` via `urlSearch`).
- **`isComingSoonCategory`**: `category === "man" || category === "kids"`
  — an entirely separate code path that skips the product fetch
  altogether and renders only `<ComingSoonModal>`; per the [[P1-06]]/
  shipping-restriction fixes documentation, this reflects a genuine
  product decision (those categories aren't launched yet), not a bug.
- **Product loading is debounced by 250ms** (`window.setTimeout` inside
  the fetch effect, cleared on every dependency change) — so rapid
  typing in the search box or repeated filter changes don't each fire
  their own request; only the filter state that's stayed stable for
  250ms triggers a fetch.
- **Pagination is flattened client-side**: the fetch loop follows
  `data.next` up to 20 pages (`page_size=200` per page, so this caps out
  at 4,000 products before silently stopping), concatenating every page
  into one `allProducts` array — there's no "load more" or page-by-page
  UI; the whole matching set (up to the cap) is fetched and held in
  memory, then client-side `products` just re-sorts that same array via
  `compareProducts` whenever `ordering` changes (sorting doesn't refetch).
- **The wishlist set** (`wishlistIds`, a `Set<number>`) is loaded once per
  `isAuthed` change from `GET /products/wishlist/` (unpaginated read into
  a `Set` for O(1) membership checks on every card), separately from the
  main product fetch — a guest sees an empty set and every card's
  wishlist button, when clicked, redirects to `/login-choice` instead of
  toggling.
- **The size-selection → custom-length → custom-measurements pipeline**
  (`handleAddToCart` → `continueAfterSize` → `commitAddToCart`,
  orchestrated through `sizeModalProductId`/`pendingCartSelection`/
  `customModalProduct` state): clicking "Add to cart" with only one
  available size that's specifically named `"CUSTOM SIZE"` auto-selects
  it (skips the size modal entirely, since there's nothing to choose);
  with a size already remembered in `selectedSizeByProduct` from an
  earlier click on the same product, reuses it; otherwise opens
  `SizeModal`. Once a concrete (non-custom) size is confirmed, if the
  product `allows_custom_length`, opens `CustomLengthModal` next instead
  of adding immediately (`continueAfterSize`) — the customer chooses
  standard or custom length there before the add actually commits. If the
  chosen size is `"CUSTOM SIZE"` and no measurements were passed yet,
  opens `CustomMeasurementsModal` and *remembers* the picked size id in
  `selectedSizeByProduct` for when the measurements come back through
  `handleCustomMeasurementsSubmit`, which re-enters `handleAddToCart` with
  the collected data.
- **`commitAddToCart`**: the actual terminal step — checks
  `addBusyByProduct[product.id]` to prevent a double-submit, re-verifies
  the picked size still has stock (`picked.quantity <= 0` → a native
  `window.alert("This size is out of stock.")`, since stock could have
  changed between opening the modal chain and confirming), builds the
  same shape of payload every other add-to-cart call site in this app
  builds (measurements + custom-length fields, even though the backend
  ignores the custom-length cm/surcharge values sent — same as
  `serverCartSlice.ts`'s `postCartItem`), dispatches to either the server
  cart or guest cart depending on `isAuthed`, and fires
  `trackTikTok("AddToCart", ...)` only after a successful add.
- **`getApiErrorMessage`**: its own independent error-extraction ladder
  (a fourth or fifth such implementation in this codebase, alongside
  `api/auth.ts`'s `getErrorMessage`, `utils/newsletter.ts`'s
  `extractBestErrorMessage`, and `Register.tsx`'s `getServerMessage`) —
  checks a fixed preferred-key list (`quantity`, `product_size_id`,
  `detail`, `non_field_errors`) before falling through to any array/string
  value found under any key, surfaced via `window.alert(...)` on
  `commitAddToCart` failure.

**What it talks to:** `api/axiosInstance.ts` (`GET /products/`, `GET
/products/wishlist/`, `POST`/`DELETE /products/{id}/wishlist/`, `POST
/products/{id}/subscribe_back_in_stock/`), `store/serverCartSlice.ts`,
`store/wishListSlice.ts` (`fetchWishlistCount`), `utils/cartSlice.ts`
(`addToCart`), `utils/tiktokPixel.ts`, `hooks/useDialogDismiss.ts` (used
by all four of this file's local modal components),
`sessionStorage` (`notify_email` — remembers a guest's notify-me email
for the rest of the browser session so it doesn't have to be re-typed
per product).

**Watch out for:**
- **`NotifyModal`, `SizeModal`, `CustomLengthModal`, and `ComingSoonModal`
  are defined as local function components inside this same file**,
  not extracted to `components/` — unlike `CustomMeasurementsModal.tsx`
  and `ProductModal.tsx`, which are shared, top-level components. This
  means none of these four are reusable outside `ProductCatalog.tsx`
  even though structurally they follow the exact same `useDialogDismiss`
  wiring pattern as the extracted ones.
- The 20-page fetch cap (`page < 20`) means a catalog with more than
  4,000 matching products (at `page_size=200`) would silently truncate
  rather than error — **unverified** whether the current catalog is
  anywhere near that size; likely not a practical concern today but a
  latent limit worth knowing about.
- `commitAddToCart`'s stock re-check (`picked.quantity <= 0`) uses the
  size's quantity as known **at the moment the modal chain started**
  (from `getProductSizes(product)`, itself derived from the `allProducts`
  array fetched once) — not a fresh server read at the moment of
  confirming — so a size that sold out in the seconds between opening
  the size modal and clicking "Continue"/"Add Custom Length" wouldn't be
  caught by this client-side check at all; the actual authoritative
  stock check happens server-side in `CartItemAPIView`, which is why
  `getApiErrorMessage`'s alert path exists — the client-side check is
  a UX nicety for the common case, not the source of truth.

**Interview questions:**
- *Q: Why is `selectedSizeByProduct` keyed by product id (a `Record<number,
  number>`) rather than component-local state inside a per-card
  component?* — Because there's no per-card component here — every
  product card is rendered inline inside one big `.map()` in this same
  function, so "remembered selected size" has to live in the parent's
  own state, indexed by product id, rather than in each card's own local
  `useState` the way a properly extracted `<ProductCard>` component could
  hold it.
- *Q: Why does the fetch effect use a 250ms `setTimeout` instead of a
  debounce utility from a library?* — It's a small enough pattern (set a
  timer, clear it in the cleanup function if the effect re-runs before it
  fires) that a dedicated debounce dependency isn't needed — the
  `useEffect` cleanup function *is* the cancellation mechanism, which is
  the same trick most hand-rolled React debounce implementations use.
- *Q: Trace what happens when a customer picks a non-custom size for a
  product that `allows_custom_length`, then chooses "Standard Length" in
  the length modal.* — `handleAddToCart` calls `continueAfterSize`, which
  sees `allows_custom_length === true` and sets `pendingCartSelection`
  instead of adding immediately — this renders `CustomLengthModal`.
  Clicking "Standard Length" calls `handleStandardLength`, which clears
  `pendingCartSelection` and calls `commitAddToCart(product, sizeId,
  measurements, false)` — the `false` for `customLengthSelected` means
  the add-to-cart payload sets `custom_length_selected: false`,
  `custom_length_cm: null`, `custom_length_surcharge: 0`, i.e. exactly
  the standard, no-surcharge product.
- **Harder follow-up:** *Q: Could a product with `allows_custom_length
  === true` **and** a size literally named `"CUSTOM SIZE"` end up
  showing both the custom-length modal and the custom-measurements modal
  in sequence for the same add-to-cart click? Walk through it.* — A: Yes.
  `handleAddToCart` first resolves the size — if it's the single
  available size and it's `"CUSTOM SIZE"`, it's auto-picked (skipping
  `SizeModal`); since it's `"CUSTOM SIZE"` and no measurements were
  passed yet, `handleAddToCart` opens `CustomMeasurementsModal` instead
  of calling `continueAfterSize` at all — the custom-length branch inside
  `continueAfterSize` is never reached on this first pass, because the
  custom-size check happens *before* `continueAfterSize` is called. Once
  the customer submits measurements, `handleCustomMeasurementsSubmit`
  re-enters `handleAddToCart(product, data)` — this time with
  `measurements` present, so the `isCustom && !measurements` branch is
  skipped and it falls through to `continueAfterSize`, which *now* checks
  `allows_custom_length` and opens `CustomLengthModal` if true. So yes:
  measurements first, then custom-length choice, as two separate modal
  steps in sequence — driven by `handleAddToCart` being re-entered with
  different state on the second pass, not by any single linear flow.

---

### `src/view/ProductDetails.tsx`

**What it is:** The individual product page — full description, care
instructions, image gallery with a lightbox, size selection, custom
length, and the add-to-cart/wishlist actions, for one product identified
by `:id` in the URL.

**Why it exists:** The catalog card only shows a size/summary; this page
is where a customer sees everything about one product and commits to a
purchase.

**What it exports:** `export default function ProductDetails()`. Routed
at `/product/:id`.

**How it works:**
- **`productId`**: parsed from `useParams().id` via `safeNumber` (must be
  a finite number greater than 0) — an invalid id (e.g. `/product/abc`)
  short-circuits straight to an error state without ever calling the API.
- **Fetches the product fresh on every `productId` change** (`GET
  /products/{id}/`), resetting *every* piece of per-product local state
  (`selectedSizeId`, `customLengthSelected`, `activeImageIndex`,
  `isCareOpen`, both modal-open flags) in the same effect — so navigating
  directly from one product's page to another via a color-variant swatch
  (`navigate(/product/${variant.id})`) correctly resets the whole UI
  rather than carrying over the previous product's selected size or open
  panels.
- **Pixel tracking fires once per loaded product** (`ViewContent`, both
  `trackTikTok` and `trackMeta`, in a `useEffect` keyed on `product`) —
  separately from `trackAddToCart`'s `AddToCart` event, which only fires
  from inside `addProductToCart` after a successful add.
- **`imagesForGallery`**: deduplicates the main image with the rest of
  the product's images (`Array.from(new Set(...))`, so a main image that
  also appears in the `images` array isn't shown twice), each passed
  through `toHttps`; falls back to a single-element array containing
  `fallbackImg` if there are no usable images at all — so
  `imagesForGallery.length` is never actually zero, simplifying the
  thumbnail-rendering logic downstream (`imagesForGallery.length > 1`
  gates whether thumbnails render at all).
- **The image lightbox** (`isImageModalOpen`): its own **hand-rolled**
  Escape-key listener and body-scroll lock, written inline in a
  `useEffect` rather than delegating to `useDialogDismiss` — the only
  modal-like UI in this file that doesn't use the shared hook (see Watch
  out for).
- **`addProductToCart`**: shared by both the "no custom sizing needed"
  path (called directly from `handleAddToCart`) and the
  "`CustomMeasurementsModal`'s `onSubmit`" path (called with the
  collected `measurements`) — branches on `authed` exactly like every
  other add-to-cart call site in this app: `serverCart.addCartItem` +
  `fetchCart()` for an authenticated user, `addToCart` (guest) otherwise.
- **`handleWishlist`**: `POST`/`DELETE /products/{id}/wishlist/`
  depending on the current `product.is_in_wishlist` value, then
  **optimistically flips that same field on local `product` state**
  immediately after the request resolves (not before — this isn't a
  true optimistic update that flips before the request, just an
  update-after-success that avoids a full product re-fetch) and separately
  dispatches `fetchWishlistCount()` to keep the header badge in sync.

**What it talks to:** `api/axiosInstance.ts` (`GET /products/{id}/`,
`POST`/`DELETE /products/{id}/wishlist/`), `store/serverCartSlice.ts`,
`store/wishListSlice.ts`, `utils/cartSlice.ts`, `types/token.ts`
(`isAuthenticated`), `utils/images.ts` (`toHttps`), `utils/metaPixel.ts`,
`utils/tiktokPixel.ts`, `components/CustomMeasurementsModal.tsx`.

**Watch out for:**
- **This is the one modal-like UI in the whole codebase that doesn't use
  `useDialogDismiss`** — the image lightbox reimplements just the
  Escape-to-close and body-scroll-lock pieces manually, with no
  overlay-mousedown-to-close wiring at the hook level (it does have a
  dedicated `product-detail__modal-backdrop` button that closes on click,
  functionally equivalent, just built as an actual `<button>` rather than
  through the hook's overlay-ref pattern) and no Tab-focus-trap at all —
  a keyboard user tabbing through the open lightbox can tab out to the
  page behind it, the exact class of gap [[P1-15]] fixed for every other
  modal in the app via the shared hook.
- `handleWishlist`'s local-state flip after a successful request means
  the UI trusts its own request's success/failure rather than the
  response body's actual content — the request either succeeds (flip
  the boolean) or it doesn't (show an error, leave state unchanged); the
  backend's response body isn't inspected for the actual resulting
  wishlist state at all.

**Interview questions:**
- *Q: Why does the product-load effect reset `activeImageIndex`,
  `isCareOpen`, and both modal-open booleans, not just the size
  selection?* — Because all of that state describes *this specific
  product's* UI, and the component doesn't unmount/remount between two
  different products (React Router keeps the same component instance
  alive across a `/product/1` → `/product/2` navigation since it's the
  same route pattern) — without the explicit reset, a customer who had,
  say, "Care Instructions" expanded on one product would see it still
  expanded after navigating to a completely different product via a
  color-variant swatch.
- *Q: Why is `addProductToCart` written to accept an optional
  `measurements` parameter rather than being two separate functions for
  the "no measurements needed" and "measurements collected" cases?* — The
  add-to-cart payload shape is identical either way (measurement fields
  just default to empty strings via `measurements?.custom_bust ?? ""`
  etc.) — splitting it into two functions would duplicate the entire
  payload-building and dispatch logic for a difference that's really just
  "were measurements collected first."
- **Harder follow-up:** *Q: If you were asked to bring this file's image
  lightbox in line with every other modal in the app, what specifically
  would need to change, and what's the smallest-risk way to verify the
  change didn't break anything?* — A: Replace the manual
  Escape-key-listener/scroll-lock `useEffect` with `overlayRef`/
  `contentRef` refs and a `useDialogDismiss(overlayRef, contentRef,
  () => setIsImageModalOpen(false), isImageModalOpen)` call, matching
  `ProductModal.tsx`'s `active={!!product}`-style usage for a
  conditionally-rendered modal; the backdrop `<button>`'s own `onClick`
  can stay (it's harmless alongside the hook's overlay-mousedown
  handling, or could be removed in favor of the hook's own overlay-click
  detection). To verify: `ProductDetails.test.tsx`'s existing "opens the
  image modal"/"closes on Escape" tests should keep passing unchanged
  (they assert on behavior, not implementation), and new tests mirroring
  `useDialogDismiss.test.tsx`'s Tab-trap assertions would confirm the
  previously-missing keyboard trap now works — a low-risk change because
  the hook's observable behavior is a strict superset of what the manual
  implementation already did.

---

### `src/view/WishList.tsx`

**What it is:** The saved-items page — search/sort/price-filtered list of
wishlisted products, each openable into `ProductModal` for adding to
cart.

**Why it exists:** A dedicated view over the same `/products/wishlist/`
data `ProductCatalog.tsx` also reads a count from
(`/products/wishlist/count/`) and toggles membership in
(`/products/{id}/wishlist/`) — this page is the one place a customer
manages the *whole* saved list rather than one item at a time from a
catalog card.

**What it exports:** `export default function WishList()`. Routed at
`/wishlist`, behind `PrivateRoute`.

**How it works:**
- **Server-side filtering for sort/price, client-side filtering for
  search** — a deliberate split: `ordering`/`minPrice`/`maxPrice`
  changes each trigger a fresh `GET /products/wishlist/` request (with
  an `AbortController` cancelling any still-in-flight previous request,
  `signal: ctrl.signal`), but `searchTerm` only filters the
  already-fetched `products` array locally (`filtered`, a `useMemo`) —
  confirmed directly by `WishList.test.tsx`'s "filters items by the
  search input without re-fetching from the server" test, which asserts
  the API call count doesn't change while typing into the search box.
- **`categoryParam`** comes from the URL (`?category=`) but isn't
  exposed as an editable filter control on this page — it's read once
  per render from `location.search` and passed straight through to the
  API call; **unverified** which other page links to `/wishlist?category=...`
  to actually set it (likely nothing does yet, or it's a forward-compatible
  hook for a future feature — not observed being written to anywhere in
  this read-through).
- **`handleRemove`**: `DELETE /products/{id}/wishlist/`, removes the item
  from local `products` state and decrements `serverTotal` locally
  (`Math.max(0, t - 1)`, no re-fetch), dispatches
  `fetchWishlistCount()` for the header badge, **and** writes
  `localStorage.setItem("wishlist:ping", String(Date.now()))` — the
  cross-tab signal `hooks/useAuthStorageSync.ts` listens for, so a
  wishlist removal here is reflected in another open tab's count too.
- **`ProductModal`** is reused here exactly as-is (imported from
  `components/`), opened via `setModalProduct(product)` when "ADD TO
  CART" is clicked on a card — this page doesn't reimplement any
  add-to-cart logic itself; it delegates entirely to the modal.

**What it talks to:** `api/axiosInstance.ts` (`GET /products/wishlist/`,
`DELETE /products/{id}/wishlist/`), `store/wishListSlice.ts`
(`fetchWishlistCount`), `components/ProductModal.tsx`, `localStorage`
(`wishlist:ping`, write-only from this file's perspective).

**Watch out for:** The `isOut = !product.available || !product.in_stock`
badge/disabled-button logic here is a **third** independent copy of the
same out-of-stock check `ProductCatalog.tsx`'s `getProductBadge` and
`ProductDetails.tsx`'s `isOut` each compute separately — all three
compute the identical boolean from the identical two fields, with no
shared helper.

**Interview questions:**
- *Q: Why does changing the sort order or price filters re-fetch from
  the server, while typing a search term doesn't?* — **Unverified** the
  exact reasoning from a comment (there isn't one), but the practical
  effect is that sort/price changes need the *set* of matching results
  to change (a price filter genuinely excludes items server-side), while
  a search term only needs to narrow what's already been fetched — doing
  that client-side avoids a network round-trip per keystroke for a
  filter that doesn't change which rows exist, only which of the
  already-loaded ones are shown.
- *Q: Why does `handleRemove` write to `localStorage["wishlist:ping"]`
  in addition to dispatching `fetchWishlistCount()`?* — `fetchWishlistCount()`
  updates *this* tab's Redux state; the `"wishlist:ping"` write is
  specifically for *other* open tabs, which can't see this tab's Redux
  dispatch at all — only a `"storage"` event (which
  `useAuthStorageSync.ts` listens for) crosses the tab boundary, and that
  event only fires when a `localStorage` key's value actually changes,
  hence writing a fresh timestamp rather than a fixed value.

---

### `src/view/Dashboard.tsx`

**What it is:** The account page — profile form (name, email, shipping
address) and the account-deletion (deactivation) flow.

**Why it exists:** One page for viewing/editing the account's stored
profile data and initiating the account-deactivation flow described in
the fixes documentation's [[P0-04]]/[[Delete-account-copy]] entries.

**What it exports:** `export default function Dashboard()`. Routed at
`/dashboard`, behind `PrivateRoute`.

**How it works:**
- **Three layers of profile data, merged with a clear precedence**:
  `localStorage["tresse_profile_v1"]` (the form's own previously-saved
  local snapshot) takes priority as the *initial* state
  (`readProfileFromStorage() ?? buildDefaultProfile()`, the latter
  seeding `firstName`/`lastName`/`email` from `localStorage["user"]` — the
  auth identity, not the profile record); then, once `GET
  /accounts/profile/` resolves, `mapApiToForm` converts the response and
  merges it in **field by field**, preferring whatever's already
  non-empty in local state and only filling in from the server for
  fields that are still empty (`prev.firstName || fromApi.firstName`,
  repeated per field). This means a field edited locally but not yet
  saved to the server survives a page reload's server fetch without
  being overwritten by (possibly stale, pre-edit) server data.
- **`mapApiToForm`/`mapFormToApi`**: convert between the form's camelCase
  local shape and the API's snake_case shape — as of [[P1-04]], these
  functions' snake_case side genuinely matches what `ProfileAPIView`
  sends and expects; before that fix, the *backend* used camelCase keys
  instead, so `mapFormToApi`'s payload was silently dropping four fields
  server-side despite this frontend code being correct all along (see
  `types/profile.ts`'s section above for the full explanation of that
  mismatch).
- **`handleSave`**: writes to `localStorage` **immediately**, before the
  API call even starts (`writeProfileToStorage(form)`) — so the local
  snapshot is durable even if the network request that follows fails
  entirely. Validates email format locally (blank is valid — only a
  non-empty, malformed value is rejected) before attempting the `PUT`.
  On success: `"Saved."`. On failure: `"Saved locally. (Server sync
  failed.)"` — the message is explicit that the *local* save already
  happened, distinguishing "your data is safe on this device but not yet
  synced" from an outright failure.
- **The delete-account modal** is a fully **hand-rolled** dialog — its
  own `overlayRef`/`modalRef`/`lastFocusedRef`, its own Escape listener,
  its own overlay-mousedown-to-close handler, its own focus-restore-on-close,
  and its own auto-focus-on-open (via a `data-autofocus="true"` attribute
  on the primary button, found with `querySelector` inside a
  `window.setTimeout(..., 0)` rather than a ref pointed straight at the
  button) — structurally a complete reimplementation of what
  `useDialogDismiss` already provides, written independently rather than
  using the shared hook (see Watch out for). It does **not** implement a
  Tab-focus trap, unlike the hook.
- **`handleDeleteAccount`**: `POST /accounts/delete-account/ {confirm:
  true}`, and on success clears `access`/`refresh`/`user`/the profile
  storage key from `localStorage` directly — **not** through
  `utils/authSlice.ts`'s `logout()` action or `types/token.ts`'s
  `clearAuthStorage()`, so Redux's `auth` slice state is **not** updated
  by this call at all (see Watch out for).

**What it talks to:** `api/axiosInstance.ts` (`GET`/`PUT
/accounts/profile/`, `POST /accounts/delete-account/`), `localStorage`
directly throughout (`tresse_profile_v1`, `user`, `access`, `refresh`).
Backend: `ProfileAPIView`, `DeleteAccountAPIView`.

**Watch out for:**
- **The delete-account modal is a sixth independent reimplementation of
  dialog-dismiss behavior in this codebase** (alongside the canonical
  `useDialogDismiss` hook, `ProductDetails.tsx`'s image lightbox, and —
  more loosely — a few other ad hoc `Escape`/overlay handlers elsewhere)
  — it duplicates the hook's overlay-mousedown and Escape logic almost
  exactly (down to the same "attached imperatively, not as a JSX prop"
  comment pattern seen in `useDialogDismiss.ts` itself), but has no Tab
  trap, meaning a keyboard user in this specific modal can tab out to the
  page behind it — the same class of gap [[P1-15]] fixed everywhere else
  by centralizing into the hook, just not here.
- **`handleDeleteAccount` bypasses Redux entirely on success.** After
  clearing `localStorage`'s auth keys directly, `state.auth.isLoggedIn`
  in Redux is still whatever it was before the delete — the UI (header,
  route guards) doesn't reactively update to a logged-out state purely
  from this action; it would only reflect the change on a full page
  reload (which re-derives `authSlice`'s initial state fresh from the
  now-cleared `localStorage`) or if something else separately dispatches
  `logout()`. **Verified directly** by reading this function: no
  `dispatch` call, no import of `utils/authSlice.ts` at all in this file.
- `mapApiToForm`'s field-by-field "prefer non-empty local value" merge
  means a field a customer *intentionally cleared* locally (typed
  something, then deleted it back to empty) but hasn't yet saved would
  be silently refilled from the server on the next load — the merge
  can't distinguish "never touched" from "touched and cleared," since
  both look like an empty string.

**Interview questions:**
- *Q: Why does `handleSave` write to `localStorage` before attempting the
  API call, rather than only after a successful response?* — So the
  user's edits are never lost purely because of a network failure — the
  local copy is the fallback of record, and the UI's own message on
  failure ("Saved locally...") is honest about exactly that: the data is
  safe on this device even though the server doesn't have it yet.
- *Q: What's the concrete, user-visible consequence of `handleDeleteAccount`
  not dispatching `logout()`?* — Immediately after a successful account
  deletion, Redux still believes the user is logged in — components
  reading `state.auth.isLoggedIn` (the header's account menu, any
  `PrivateRoute`-gated link) wouldn't reactively reflect the logged-out
  state without a full page reload, even though the actual tokens are
  already gone from `localStorage` (so the *next* authenticated API call
  would 401 and trigger the app-wide unauthorized handler anyway,
  eventually reaching the same end state through a different path).
- **Harder follow-up:** *Q: Given [[P0-04]]'s fix means "forgot password"
  can no longer reactivate a deactivated account, and this page's modal
  copy now correctly says "deactivate" instead of "delete" — trace what
  actually happens server-side when `handleDeleteAccount` succeeds, and
  how a customer gets back in within the 30-day window.* — A: `POST
  /accounts/delete-account/` is handled by `DeleteAccountAPIView`
  (`tresse_backend/accounts/views.py`), which sets the account inactive
  (`is_active=False`, `deleted_at=timezone.now()` — per the pattern
  described across the fixes documentation for the restore flow) and
  sends a deactivation email containing a restore link. Within
  `ACCOUNT_RESTORE_WINDOW_DAYS` (30 days by default), following that link
  routes to `/account/restore/:uidb64/:token`
  (`components/AccountRestore.tsx`), which calls
  `AccountRestoreConfirmAPIView` — as of [[P1-17]], that view validates
  the new password with Django's `validate_password` rather than a bare
  length check. Critically, as of [[P0-04]], "forgot password" (`/accounts/request-password-reset/`
  → `/accounts/reset-password/confirm/`) can **no longer** be used as a
  side-door back into a deactivated account — only this restore link,
  within the window, works.

---

### Shopping-flow view test files, as a group (`Cart.test.tsx`, `Order.test.tsx`, `OrderHistory.test.tsx`, `ProductCatalog.test.tsx`, `ProductDetails.test.tsx`, `WishList.test.tsx`, `Dashboard.test.tsx`)

**What they mock, in common:** every one of these seven mocks
`../api/axiosInstance` down to `{get, post, put, delete}` spies — no real
HTTP anywhere. The five that involve auth-sensitive rendering
(`Cart.test.tsx`, `Order.test.tsx`, `ProductCatalog.test.tsx`,
`ProductDetails.test.tsx`, `WishList.test.tsx`) also mock `../types/token`
entirely, and most mock `react-router-dom`'s `useNavigate` with a spy
(real router otherwise, via `vi.importActual`) so navigation calls can be
asserted without a real route existing to navigate to.
`ProductCatalog.test.tsx`/`ProductDetails.test.tsx` additionally mock
`utils/tiktokPixel`/`utils/metaPixel` entirely (`{trackTikTok: vi.fn()}`
etc.) so pixel calls never touch `window.fbq`/`window.ttq`.
`Cart.test.tsx`, `Order.test.tsx`, `ProductCatalog.test.tsx` all
independently rebuild the same four-reducer test store (`auth`,
`serverCart`, `wishlist`, `cart` — `Cart.test.tsx`/`Order.test.tsx` via
`combineReducers` first for the same `TS2353` reason documented in
`serverCartSlice.test.ts`'s own section above) rather than sharing a
single test-store helper — the setup is duplicated per file, not
factored out.

**What they assert, by file, focusing on what's non-obvious rather than
restating the component sections above:**
- **`Cart.test.tsx`**: guest vs. server rendering branch correctly on
  auth state and which cart has items (including the explicit
  "prefers server cart over guest cart when both are authed and server
  has items" case); totals include the custom-length surcharge;
  Pay is disabled for an incomplete custom-size line and enabled once all
  four required measurements are present; unauthenticated Pay redirects
  to `/login-choice?next=%2Forder`. No test in this file exercises the
  Meta-cart-import feature at all (see `Cart.tsx`'s Watch out for).
- **`Order.test.tsx`**: subtotal math including the surcharge; the promo
  box shows only when `isFirstOrder` resolves true and hides once a paid
  order exists in history (`mockCartEndpoint`'s `hasPaidOrder` flag);
  clicking the promo code calls `navigator.clipboard.writeText` and shows
  "Copied"; the checkout button stays disabled until the policy checkbox
  is checked, and — for an order containing a `"CUSTOM SIZE"` item —
  stays disabled even after the policy checkbox until the final-sale
  checkbox is *also* checked; a successful checkout call redirects via
  `window.location.assign` (itself replaced with a `vi.fn()` via
  `Object.defineProperty(window, "location", ...)`, since `jsdom`'s real
  `window.location` can't be reassigned/spied on directly); a rejected
  checkout call surfaces the backend's `detail` message or a generic
  fallback.
- **`OrderHistory.test.tsx`** (already read in full while implementing
  the [[P1-05]]/[[P1-06]] fix — described here for completeness): the
  Return button is shown within 14 days of `delivered_at` and on exactly
  day 14, hidden with no `delivered_at` or past day 14 (even for an
  order placed only a day ago — the direct regression test that the
  window counts from delivery, not creation), and hidden once
  `return_status` is already set; declining the `window.confirm` posts
  nothing; confirming posts to `/orders/1/return/` and replaces the order
  card's status in place; a rejection shows the server's message, a
  non-server failure shows a generic one. The pre-existing cancel tests
  (24-hour window, created_at-based) are unchanged from before this
  file's return-flow rewrite.
- **`ProductCatalog.test.tsx`**: loading/error/empty states; search input
  eventually calls the API with `search=<term>` in the URL (using a
  `{timeout: 2000}` `waitFor` to accommodate the component's own 250ms
  debounce); out-of-stock products show a restock-alert button instead of
  Add to Cart and the OUT OF STOCK badge; the notify modal collects a
  guest email and posts it; wishlist toggling redirects when logged out
  and posts when logged in; the category subnav (SUMMER/SWEATERS/
  CARDIGANS/DRESSES) shows only for `?category=woman` and not for
  `?category=man` (which instead shows the Coming Soon modal). Notably
  thin coverage relative to the component's actual complexity: no test
  in this file exercises the multi-step size → custom-length →
  custom-measurements modal chain at all — only the trivial
  single-available-size, no-custom-length path is asserted.
- **`ProductDetails.test.tsx`**: invalid/failed product id and load
  failure states; size sort order and out-of-stock size disabling; care
  instructions toggle; add-to-cart branches correctly on `isAuthenticated()`
  (guest vs. server, asserting the server path's exact request body
  includes `product_size_id`); opening the custom-measurements modal for
  a `"CUSTOM SIZE"` selection; custom-length surcharge added to the
  displayed price on checkbox toggle; wishlist redirect-when-guest and
  toggle-when-authed; the image modal opens on click and closes on
  Escape — this last one is the only place this file's hand-rolled
  Escape handling (see the component's own Watch out for) actually gets
  tested, and it passes today precisely because the manual
  implementation, while not using the shared hook, still correctly
  implements the one behavior (Escape) this test checks.
- **`WishList.test.tsx`**: loading/empty/fetch-failure states; the
  heading's `(N • showing M)` count format when a client-side search
  narrows the visible set without re-fetching (explicitly asserted via
  `mockedApi.get.mock.calls.length` staying constant while typing);
  sort/price-filter changes do re-fetch with the new params; removing an
  item updates the grid, decrements the count, and re-fetches
  `/products/wishlist/count/`; clicking a card image navigates to the
  product page; opening `ProductModal` from "ADD TO CART" and completing
  a guest add-to-cart through it; the out-of-stock badge/disabled-button
  pair; the NOTIFY ME flow inside the modal (`vi.mocked(getAccessToken).mockReturnValue("token123")`
  temporarily, restored in a `finally` block) showing "SUBSCRIBED" on
  success and "TRY AGAIN" — never "SUBSCRIBED" — on a rejected request,
  the direct regression coverage for [[P1-01]].
- **`Dashboard.test.tsx`**: the three-way profile-source precedence
  (`localStorage["user"]` fallback, saved `tresse_profile_v1` taking
  priority, and the field-by-field merge that keeps a non-empty local
  value over a server one while still filling in fields the local copy
  left empty); saving writes to `localStorage` and calls `PUT` with the
  expected snake_case body; an invalid email blocks the request
  entirely; a failed `PUT` shows the "Saved locally..." fallback message
  rather than a bare error; Reset clears back to defaults; the delete
  modal opens/closes on the Cancel button and on Escape (exercising this
  file's own hand-rolled dialog logic, not `useDialogDismiss`); a
  successful delete calls the endpoint, shows the confirmation text, and
  clears `access`/`refresh`/`user` from `localStorage` — note this test
  only checks `localStorage`, never `state.auth.isLoggedIn`, so it would
  not catch the Redux-desync issue described in `Dashboard.tsx`'s own
  Watch out for even if it existed as a regression.

**Interview question:** *Q: `ProductCatalog.test.tsx` covers the
single-size, no-custom-length add-to-cart path in detail but never
exercises the size-modal → custom-length-modal → custom-measurements-modal
chain. What's the practical risk of that gap?* — A change to
`continueAfterSize`'s branching logic (e.g. the order in which the
custom-size check and the custom-length check are evaluated — the exact
sequencing the component section's "harder follow-up" question above
walks through) could silently break the multi-step flow for a product
that needs both custom sizing and custom length, and none of the
existing tests would catch it — the only safety net for that specific
interaction is manual testing or reading the code path directly, not
this test suite.

---

### `src/view/Header.tsx`

**What it is:** The site-wide header — hamburger category sidebar, logo,
live product search, the account dropdown / login link, and the cart
count badge.

**Why it exists:** Persistent chrome rendered once per page from
`App.tsx`, outside `<Routes>`.

**How it works:** Three independent overlay-like UIs, each with its own
hand-rolled open/close logic (none use `useDialogDismiss`): the category
sidebar (`isMenuOpen` — Escape via an `onKeyDown` on the `<aside
role="dialog">` itself, not a `window`-level listener; an imperatively-attached
backdrop-click handler with the same "stays non-interactive for
assistive tech" comment pattern seen elsewhere; auto-focus via
`window.setTimeout(..., 0)`; no focus-restore-on-close and no Tab
trap), the user account dropdown (`isUserMenuOpen` — closes on any
`mousedown` outside `userMenuWrapRef`, and on Escape only while the
trigger button itself has focus, via its own `onKeyDown`), and the search
dropdown (`isSearchOpen` — same outside-click pattern, plus Escape while
the input is focused). **`cartCount`** switches between the server cart's
summed quantities and the guest cart's `selectGuestCartCount` selector
based on `isAuthed` (from `isAuthenticated()`, i.e. a fresh
`localStorage` read — not the Redux `user` value read one line below it
for display purposes, which is a *separate* `useAppSelector` call — two
different ways of asking "is someone logged in" within the same
component). **Search** debounces via a 250ms `window.setTimeout` (the
same hand-rolled debounce pattern as `ProductCatalog.tsx`), requires at
least 2 characters, calls `GET /products/` with `{search, page_size: 6}`,
and offers both inline result rows and a "View all results" link to
`/catalog?search=...`. **`handleLogout`** is notably the most thorough
logout implementation in the codebase: `clearAuthStorage()` (tokens +
user), `dispatch(logout())` (Redux), `dispatch(clearServerCart())`,
`dispatch(setCount(0))` (wishlist), `dispatch(clearGuestCart())`, **and**
the `"wishlist:ping"` cross-tab signal — unlike `Dashboard.tsx`'s
account-deletion flow, this path does correctly clear Redux state, not
just `localStorage`.

**What it talks to:** `api/axiosInstance.ts` (search), `types/token.ts`
(`isAuthenticated`, `clearAuthStorage`), `utils/authSlice.ts` (`logout`),
`store/serverCartSlice.ts` (`clearServerCart`), `store/wishListSlice.ts`
(`setCount`), `utils/cartSlice.ts` (`clearCart`, `selectGuestCartCount`).
Backend: `GET /products/`.

**Watch out for:** This file is a **fourth** place with its own
independent overlay-dismiss logic (alongside the canonical hook,
`ProductDetails.tsx`'s lightbox, and `Dashboard.tsx`'s delete modal) —
and unlike those two, it has *three* separate such implementations
within one file, none sharing code with each other or with
`useDialogDismiss`. None of the three traps Tab.

**Interview question:** *Q: Why does `Header.tsx` read auth state two
different ways — `isAuthenticated()` for `cartCount`/`isAuthed` and a
`useAppSelector` for the `user` object used in the greeting/dropdown?* —
**Unverified** the exact reasoning; `isAuthenticated()` is a synchronous,
non-reactive `localStorage` check (cheap, but won't itself trigger a
re-render if it changes outside of some other state update also causing
one), while `user` needs to be the actual Redux-held object to display a
name — using the selector for that one is necessary, but using the raw
check for `isAuthed` instead of `Boolean(user)` means the two could
theoretically disagree for a moment if the two data sources ever drift
out of sync.

---

### `src/view/Home.tsx`

**What it is:** The homepage — a rotating three-column hero image
gallery, a promo video section, three collection panels, and a
newsletter signup modal that opens automatically on a timer.

**Why it exists:** The landing page and the one place the newsletter
modal (distinct from the footer's inline newsletter form) lives.

**How it works:** `pickHeroImages`/`columns` use Vite's
`import.meta.glob(..., {eager: true})` to pull in every `hero_*` image
under `assets/images/home_page/` at build time, sorted numerically by
filename, then build three columns that are the same image set rotated
by offsets 0/3/6 — so each column starts at a different point in the
same cycle. A `setTimeout`-chained `tick()` function (not `setInterval`)
advances one column per second (`COLUMN_STEP_MS`), then pauses 2 seconds
(`CYCLE_PAUSE_MS`) before repeating — deliberately staggered rather than
switching all three columns simultaneously. **The newsletter modal**
opens automatically 900ms after mount, gated by
`canShowNewsletterModal(isLoggedIn)` (`utils/newsletter.ts` — skips
entirely for a logged-in user or someone within either cooldown window).
Its focus-trap/Escape/scroll-lock logic is **hand-written inline**
(`getModalFocusableElements`, the `onKeyDown` handler) rather than using
`useDialogDismiss` — and per the [[P1-15]] fixes documentation, this
was in fact the **source** the shared hook's own Tab-trap logic was
later copied from into `useDialogDismiss.ts`, so every other modal in the
app now has this same behavior, but this file's own copy was left as-is
rather than being migrated to call the hook itself.

**What it talks to:** `utils/newsletter.ts` (the full API:
`canShowNewsletterModal`, `isValidEmail`, `markNewsletterDismissed`,
`subscribeNewsletter`), `store` (`state.auth.isLoggedIn` via
`useSelector`, not the typed `useAppSelector`).

**Watch out for:** This is the **fifth** independent dialog-dismiss
implementation in the codebase, and the only one with a Tab trap that
predates and inspired the shared hook's — yet it still isn't wired to
call `useDialogDismiss` itself, so any future improvement to the hook
(a new keyboard shortcut, a bug fix) won't automatically apply here.

**Interview question:** *Q: Why does this component use plain `useSelector`
from `react-redux` instead of `useAppSelector` from `utils/hooks.ts`,
when nearly every other component in the app uses the typed version?* —
**Unverified** — no comment explains it; functionally equivalent since
`(state: RootState) => ...` is typed inline instead, just more verbose
and bypassing the one central place that type is otherwise threaded
through.

---

### `src/view/Footer.tsx`

Site-wide footer: four trust-signal icons, brand copy, three navigation
columns (info pages, shop categories, account/policy links), an inline
newsletter form, and social links. Its newsletter form
(`isValidEmail` + `subscribeNewsletter(clean, "footer")`, from
`utils/newsletter.ts`) is a second, independent entry point into the same
subscribe flow `Home.tsx`'s modal also uses — passing `"footer"` as the
`source` so the backend/analytics can tell the two apart. **Watch out
for:** three of the four social links (Pinterest, YouTube, TikTok) are
literal placeholder `href="https://..."` values — only Instagram points
anywhere real — matching audit item P3-14 exactly; clicking any of the
three placeholder links navigates the browser to `https://...`, which
resolves to nothing meaningful.

**Interview question:** *Q: Why does the footer's newsletter form pass a
different `source` value (`"footer"`) than the homepage modal
(`"modal"`)?* — So whatever consumes the `source` field server-side (an
analytics dashboard, a segmentation rule) can tell which UI entry point
produced a given subscription, without needing two different API
endpoints for what's otherwise an identical subscribe action.

---

### `src/view/Help.tsx`, `src/view/FAQ.tsx`, `src/view/Contact.tsx`, `src/view/About.tsx`, `src/view/SizeGuide.tsx`

Five largely static content pages, grouped here since none carries
significant logic:

- **`Help.tsx`** (routed at `/help`): an anchor-linked FAQ-adjacent page
  (Contact/Orders/Shipping/Returns/Policies sections). `goAuthOr(path)`
  sends a logged-in user to `path` (e.g. `/orders`) and an anonymous one
  to `/login-choice` instead. **Watch out for:** declares
  `const _PROFILE_PATH = "/dashboard"` but never uses it anywhere in the
  file — a genuinely dead constant, matching audit item P3-29 exactly (the
  leading underscore is a naming convention marking it as intentionally
  unused, but it's still dead code sitting in the file). This is also the
  page [[P1-05]]'s fix note references directly: it's the destination
  `OrderHistory.tsx`'s old `goToReturns` used to navigate to with
  `?topic=return&order=...` query params this file has never read (no
  `useSearchParams`/`useLocation` call anywhere in it) — confirmed by
  reading the file: that dead-link behavior is exactly why the return
  flow needed fixing, and this file itself wasn't the thing that got
  changed to fix it (`OrderHistory.tsx` was, per the fixes documentation).
- **`FAQ.tsx`** (routed at `/faq`): an accordion of category-grouped
  question/answer pairs (`items`, a `useMemo`'d array), filterable by
  `activeCategory`. Its Shipping and Returns copy was rewritten as part
  of the shipping-restriction/[[P1-06]]-adjacent work described in the
  fixes documentation (now says "currently ship within the United States
  only," lists custom-sized/custom-length/swimwear as final sale
  explicitly, and adds a sales-tax Q&A) — the current file's content
  reflects that rewrite.
- **`Contact.tsx`**/**`About.tsx`**: pure static marketing copy, no
  state, no effects, no API calls — `Contact.tsx`'s only interactive
  element is a `mailto:` link to `support@tresseknitting.com` (the
  support-mailbox domain, deliberately distinct from the
  `tressehandmade.com` storefront domain — see `index.html`'s section).
- **`SizeGuide.tsx`** (routed at `/size-guide`): a two-tab (Sweaters /
  Swimwear) static measurement guide with hardcoded size-chart data
  (`SWEATER_SIZE_ROWS`, `SWIMWEAR_SIZE_ROWS`) — no API call; `activeTab`
  is the only state.

**Interview question (one, covering the group):** *Q: None of these five
pages fetch data from the backend. What does that imply about how their
content would be updated in practice?* — Any copy change (pricing tiers,
size-chart numbers, shipping policy wording) requires a code deploy —
there's no CMS or backend-driven content source for any of these pages,
so a business-side edit (e.g. updating the size chart) is a frontend
pull request, not a content-team task.

---

### `src/view/OrderSuccess.tsx`

**What it is:** The page Stripe redirects to after a successful payment
(`success_url` in the Checkout Session, per `Order.tsx`'s backend
counterpart).

**Why it exists:** Confirms payment, shows the order number if available,
fires the `Purchase` pixel event exactly once, and clears whatever cart
state remains (the order that was just paid for should no longer appear
as "in the cart").

**How it works:** Reads `?order=`/`?session_id=` from the URL;
`orderIdFromQuery` is persisted to `localStorage["tresse_last_order_id_v1"]`
so a page *refresh* on this same success page (which would lose the
query param context if Stripe's redirect isn't re-triggered) can still
show the order number from the last known value. **Purchase-event
deduplication**: builds a `sessionStorage` key
(`tresse_purchase_tracked_<purchaseRef>`) and only fires
`trackTikTok("Purchase", ...)` if that key isn't already set — guards
against the pixel firing twice if this component re-renders or
re-mounts (e.g. React Strict Mode's double-invoke in development, or a
user navigating away and back within the same tab session). Clears both
carts and re-fetches the (now server-confirmed-empty) server cart on
mount, unconditionally.

**What it talks to:** `store/serverCartSlice.ts` (`clearServerCart`,
`fetchCart`), `utils/cartSlice.ts` (`clearCart`), `utils/tiktokPixel.ts`,
`localStorage`/`sessionStorage`.

**Watch out for:** The purchase-tracking dedup key falls back to
`"unknown"` if neither `orderId` nor `sessionIdFromQuery` is available at
all (`purchaseRef = orderId || sessionIdFromQuery || "unknown"`) — two
different genuinely-untracked visits to this page in the same browser
session (e.g. two failed/ambiguous redirects) would share the same
`tresse_purchase_tracked_unknown` key and the second one's Purchase event
would be silently suppressed as a "duplicate."

**Interview question:** *Q: Why track the Purchase event from this page
at all, instead of firing it server-side from the Stripe webhook when
the `Order` is actually created?* — **Unverified** why this specific
design was chosen — a server-side Conversions API call would be more
reliable (not dependent on the customer's browser reaching this page,
not blockable by an ad blocker) but requires separate server-side
integration with Meta/TikTok's server-to-server APIs; firing client-side
from the success page is simpler to implement but strictly less
reliable — this file's whole dedup mechanism exists specifically to
compensate for the client-side approach's tendency to double-fire on
re-renders/re-visits, a problem a server-side webhook call wouldn't have
in the same way.

---

### `src/view/NewsletterUnsubscribe.tsx`

**What it is:** The page reached from the unsubscribe link in every
newsletter email — added as part of [[P0-06]] once the backend gained a
signed-token unsubscribe endpoint.

**Why it exists:** Without this page, the backend's
`POST /newsletter/unsubscribe/<token>/` endpoint (added in the same
fix) had no frontend route to actually call it from — the email's link
pointed at a URL that didn't exist yet.

**How it works:** On mount, reads `:token` from the URL and immediately
`POST`s to `/newsletter/unsubscribe/${token}/` — a missing/empty token
short-circuits to the error state without calling the endpoint at all.
Three states (`loading`/`success`/`error`) drive three different
renders; success shows the unsubscribed email (if the backend returned
one) and a "Resubscribe" button that calls `subscribeNewsletter(state.email,
"unsubscribe")` — reusing the exact same helper `Home.tsx`'s modal and
`Footer.tsx`'s form both call, with `"unsubscribe"` as the distinguishing
`source` value (the third of three `SubscribeSource` values actually
used at a real call site, alongside `"modal"`/`"footer"`).

**What it talks to:** `api/axiosInstance.ts` (`POST
/newsletter/unsubscribe/<token>/`), `utils/newsletter.ts`
(`subscribeNewsletter`). Backend: `UnsubscribeAPIView`
(`tresse_backend/newsletter/views.py`).

**Watch out for:** The "Resubscribe" button is disabled whenever
`!state.email` — so if the backend's unsubscribe response didn't include
an email (an edge case the success-state rendering already handles by
showing generic copy instead of the email), resubscribing from this page
isn't possible at all; the customer would need to use the footer or
modal form instead, typing their address in by hand.

**Interview question:** *Q: Why does a successful unsubscribe response
carry the email back to the frontend at all, instead of the frontend
already knowing it from the token?* — The token is opaque by design
(signed via `django.core.signing`, not literally the email in plain
text, per the backend fixes documentation) — the frontend has no way to
extract the email from the token itself; the only way it learns which
address was just unsubscribed is if the backend's response tells it,
which is also what makes the "Resubscribe" button possible without
asking the customer to retype their address.

---

### `src/view/NewsletterUnsubscribe.test.tsx`

Covers the three states end-to-end against a mocked `api/axiosInstance`:
a missing token short-circuits to the error state with no request made;
a successful unsubscribe shows the confirmation (with the returned
email) and a working "Resubscribe" button; a failed/expired-token
response shows the server's message instead. The resubscribe action
itself is tested both ways: a successful `subscribeNewsletter` call shows
a confirmation and hides the button, a failed one shows an error and
keeps the button available to retry.

**Interview question:** *Q: Why is a missing-token case tested as its
own scenario, distinct from a rejected API call?* — Because it's handled
by an entirely different code path — the component checks for an empty
token *before* ever calling the endpoint, so this test is really
confirming "no network call happens for an obviously-invalid URL," not
just "the error UI renders," which a rejected-request test alone
wouldn't prove.

---

## `view/policies/`

Six purely static legal/informational pages
(`ReturnPolicy.tsx`, `ShippingPolicy.tsx`, `PrivacyPolicy.tsx`,
`TermsOfService.tsx`, `CookiePolicy.tsx`, `AccessibilityStatement.tsx`),
all sharing one stylesheet (`styles/Policy.css`) and one structural
pattern (`<section className="policy"><div className="policy__content">`
with `<section className="policy__section">` blocks, each with its own
`aria-labelledby` heading pair). None has any state, effect, or API
call — legal/policy content belongs here; anything with a mailto link or
in-page navigation and nothing else fits the equally static
`Contact.tsx`/`Help.tsx` pattern in `view/` instead.

**What's worth knowing content-wise, since these pages are the
human-readable statement of rules the backend also enforces in code:**
`ReturnPolicy.tsx` states the 14-day window "from the date your order is
delivered" and lists custom-sized, personalized, and swimwear items as
final sale — matching `RequestReturnAPIView`'s server-side checks
(delivery-based window, `ReturnPolicy.FINAL_SALE`/
`NON_RETURNABLE_HYGIENE`/custom-size/custom-length rejections) exactly,
and matching `OrderHistory.tsx`'s post-[[P1-06]] `isReturnable` logic.
`ShippingPolicy.tsx` states "TRESSE currently ships within the United
States only... Canada and Europe are coming soon" — matching the
Stripe Checkout `allowed_countries: ["US"]` restriction and the
`FAQ.tsx` copy, all three changed together as one product decision (not
independently, per the fixes documentation).

**Interview question:** *Q: Why does it matter that this frontend copy
and the backend's actual enforcement (`RequestReturnAPIView`,
`allowed_countries`) agree with each other, given neither can enforce
the other?* — Because a customer only ever sees the frontend copy before
they act, and only the backend can actually refuse a request — if they
drift apart (e.g. the policy page still promises worldwide shipping after
`allowed_countries` was narrowed to `["US"]`), the customer makes a
decision based on a promise the checkout flow then can't fulfill, which
is exactly the kind of mismatch the shipping-restriction work updated
`FAQ.tsx` and `ShippingPolicy.tsx` alongside the Stripe Checkout Session
change specifically to avoid.

---

## `styles/`

Plain CSS, one file per page/component plus two shared foundation files.
No CSS-in-JS, no CSS Modules, no Tailwind (`postcss.config.js` at the
project root is actually a leftover Tailwind config that does nothing —
see the config-files section) — every component imports its own
`../../styles/<Name>.css` directly.

### `styles/variables.css`

The design-token layer: one `@font-face` declaration for the self-hosted
`tresse_font.woff2` (served from `src/assets/fonts/`, per the [[font-path]]
fix in the fixes documentation — the path here now correctly points
through `../src/assets/fonts/...` relative to `styles/`), and a large
`:root` block of custom properties grouped by comment banners — colors,
surfaces, borders, "white opacity" tokens (pre-mixed white-with-alpha
values for overlays on dark backgrounds), layout widths, section
spacing, typography (letter-tracking scale, `--font-luxury` for the
serif/custom-font stack), border radii, button heights, motion/transition
presets, shadows, overlay darkness levels, accessibility tokens
(`--focus-ring`, `--focus-offset`), z-index scale (`--z-header: 1000` <
`--z-sidebar: 1010` < `--z-dropdown: 1020` < `--z-modal: 1100` — an
explicit stacking order, not arbitrary numbers), and footer-specific
spacing. `--header-height` is redefined inside four width-based media
queries (1600px+, 1200–1599px, 768–1199px, ≤767px) — this is the one
token every other file's layout math depends on, since `index.css`'s
`.layout-main` uses it directly as `padding-top`.

**Watch out for:** the audit's C-4 correction (documented in the fixes
history) originally flagged this file as missing — a claim made from
reading `base.css` alone, which doesn't itself define the font or most
of these tokens; reading this file directly showed the font and
variables were always present. **Interview question:** *Q: Why define
`--header-height` per breakpoint here rather than in each component's
own stylesheet?* — Because it's consumed by `index.css`'s global layout
padding, not by `Header.css` alone — centralizing it means every
consumer (currently just the one) stays correct without duplicating the
same four breakpoint values.

### `styles/base.css`

Shared element resets and primitives, loaded once via `index.css`
(`@import "./variables.css"; @import "./base.css";`, in that order,
since these rules reference the tokens the first file defines):
universal `box-sizing: border-box`; `html`/`body` margin/padding resets
plus `scroll-behavior: smooth`; `img`/`picture`/`video`/`canvas`/`svg`
default to `display: block` and `max-width: 100%` (prevents the classic
"image overflows its container" default); form elements inherit font;
links inherit color and drop the underline by default; a WCAG
`:focus-visible` outline using `--focus-ring`; and `.srOnly` — the
visually-hidden-but-accessible utility class.

**Watch out for:** `.srOnly` is defined a **second time**, independently,
in `styles/Header.css` — and that second copy is missing
`white-space: nowrap` (confirmed by reading both definitions directly).
Since `Header.css` loads alongside `base.css` on every page, the later
CSS source order or specificity match determines which copy actually
wins for any `.srOnly` element rendered while `Header.css` is loaded —
matching audit item P3-11 exactly ("the second copy... will win where
both files are loaded, letting long visually-hidden labels wrap and
break layout").

**Interview question:** *Q: Why is `.srOnly` (clip the content but keep
it in the accessibility tree) preferred over `display: none` for
screen-reader-only text?* — `display: none` removes an element from the
accessibility tree entirely — screen readers wouldn't announce it either;
`.srOnly`'s clip-path/1px-sizing approach keeps the element visually
invisible and out of layout flow while remaining fully readable by
assistive technology, which is the whole point of a "screen reader only"
label like the ones used for otherwise-icon-only buttons throughout this
app.

### The rest of `styles/` — naming convention, breakpoints, and page mapping

Every other file (`About.css`, `AccountRestore.css`, `Authorization.css`,
`Cart.css`, `Contact.css`, `CookieConsent.css`,
`CustomMeasurementsModal.css`, `Dashboard.css`, `FAQ.css`, `Footer.css`,
`Header.css`, `Help.css`, `Home.css`, `LoginChoice.css`,
`NewsletterUnsubscribe.css`, `Order.css`, `OrderHistory.css`,
`OrderSuccess.css`, `PasswordChange.css`, `PasswordResetConfirm.css`,
`Policy.css`, `ProductCatalog.css`, `ProductDetail.css`,
`ProductModal.css`, `Register.css`, `SizeGuide.css`, `WishList.css`)
follows a strict one-file-per-page/component convention: the filename
matches the `.tsx` file's own name almost exactly (`OrderHistory.tsx` →
`OrderHistory.css`, `ProductModal.tsx` → `ProductModal.css`), with two
deliberate many-to-one exceptions — `Policy.css` styles all six
`view/policies/*.tsx` pages at once (they share one visual pattern, so
one stylesheet), and `ProductDetail.css` (singular) styles
`ProductDetails.tsx` (plural) — a naming mismatch between the component
and its stylesheet, not a typo in this guide.

**BEM-style class naming** is used throughout —
`.block__element--modifier` (e.g. `.cart-item__remove`,
`.catalogFilters__input--price`, `.order-history__btn--danger`) — with
the block name usually matching the page (`.dashboard__*`,
`.wishlist__*`), though a few files mix in a differently-cased block
prefix for historical reasons (`ProductCatalog.css`'s classes are a mix
of `.catalog__*` and bare `.catalogFilters`/`.catalogCardMeta`/
`.catalogCardColors` without the `__` separator).

**Responsive breakpoints are not standardized to one set of values** —
a repo-wide scan of every `@media` query across all 28 non-foundation
files turns up mobile cutoffs at 420px, 520px, 560px, 640px, 760px,
767px, 768px, 900px, 980px, 1024px, and 1200px, used inconsistently
across different files (767px/768px is the most common pair, appearing
in 19+6 places respectively, but plenty of files pick their own number
instead of reusing one of those). There's no shared set of breakpoint
custom properties in `variables.css` for component stylesheets to
reference — each file's media queries were written independently,
unlike the token system for color/spacing/typography, which *is*
centralized.

**Interview question:** *Q: Given the design-token system in
`variables.css` is thorough for color/spacing/typography, why do
breakpoints specifically fall outside it?* — **Unverified** the
historical reason; the practical effect is that a redesign of the
mobile/tablet cutoff would require finding and changing every file's own
media query individually rather than editing one shared value — the kind
of inconsistency that's easy to introduce incrementally (each new
component's media query gets picked to "look right" for that one file)
and harder to retrofit into a shared token after the fact than to have
started with one.

---

## `e2e/`

One file, `e2e/monkey-test.spec.ts` — a randomized stress/crash walk
against the running dev server, distinct from `test:e2e`'s ordinary
Playwright specs (there are none in this repo beyond this one file,
confirmed by the directory listing).

**Why it exists:** Unit tests (Vitest) mock every network call and never
exercise real routing, real timing, or real DOM event ordering across
pages — this spec instead drives a real browser through `ACTION_COUNT`
(default 150) random clicks/typed-garbage/navigations/modal-toggles and
watches for genuine crash signals.

**How it works:** A seeded PRNG (`mulberry32`, logged so a failing run
can be reproduced exactly via `MONKEY_SEED`) drives four weighted action
types (click 4, type 3, navigate 2, modal-toggle 2). Typed input comes
from `GARBAGE_STRINGS` — a deliberately adversarial list: empty/whitespace
strings, a 5,000-character string, `<script>alert(1)</script>`, a SQL
injection attempt, emoji/RTL/CJK text, `"NaN"`/`"undefined"`/`"null"` as
literal strings, a path-traversal-shaped URL. Before touching the app at
all, it `GET`s `LOCAL_API_URL` and fails immediately with an explicit
setup-instruction message if the local backend isn't reachable — this
check, and `playwright.config.ts`'s `webServer.env` forcing
`VITE_API_URL`/`VITE_BACKEND_URL` to that same local URL, exist
specifically so the walk exercises an app that can actually load data
rather than failing every request against a CORS-blocked production API.
**Console errors and transient blank-page hits are recorded but don't
fail the run** (a component's own `console.error("X load failed")` on a
handled failure is expected noise, not a crash); **only two things fail
the test**: an unhandled `pageerror` (an exception that reached
`window.onerror`) or any `5xx` response observed on the page. Results are
written to `test-results/monkey-test-summary.json` (structured) and
`monkey-test-log.txt` (per-action human-readable log) regardless of pass
or fail.

**What it talks to:** The real running app at `baseURL` (from
`playwright.config.ts`), the real local backend at `LOCAL_API_URL`, the
filesystem (`test-results/`).

**Watch out for — this file was substantially rewritten very recently
(commit `03ecb7e`, "Make the monkey test actually fail, and point it at
a local API") to fix exactly the two problems the original audit
described for this spec:** previously, its hard assertion was commented
out in favor of `expect(true).toBe(true)`, so the test was structurally
incapable of failing regardless of what happened during the walk — and
the dev server it drove inherited `tresse_frontend/.env`'s
`VITE_API_URL` pointed at the deployed Railway backend, so every data
request was CORS-blocked and the walk never actually exercised a
data-loaded app (console errors were all CORS failures, and pages like
the product modal, size selection, and checkout — the app's most
stateful surfaces — were effectively never reached, since nothing
rendered without data). The current file, read directly above, has real
hard assertions (`unhandledPageErrors`/`serverErrors` must both be
empty) and forces a local API via `playwright.config.ts`'s `webServer.env`.
**This is a live, current fix — not a stale audit finding — verify
against the file directly if you're asked about it, since the audit
report itself still describes the old, broken version.**

**Interview questions:**
- *Q: Why does console-error noise get recorded but not fail the test,
  while an unhandled page error does?* — A component logging
  `console.error` on a caught, handled failure (a failed fetch it already
  shows a "could not load" message for) is expected, deliberate behavior
  — failing the build on every such log would make the test worthless
  noise; an unhandled exception reaching `window.onerror`, by contrast,
  means something crashed in a way the app's own error handling didn't
  catch — a genuine signal worth failing a build over.
- *Q: Why is the test's title (`monkey test — ${ACTION_COUNT} random
  actions`) built from a config value but deliberately *not* from the
  random seed?* — A code comment explains it directly: Playwright looks
  up a test by its title string on a retry, and a per-process-random seed
  baked into the title would make a retry unable to find the original
  test at all, failing immediately before a single action ran; the seed
  is still logged and written to the JSON summary, so a specific run
  stays reproducible without needing to be part of the test's identity.
- **Harder follow-up:** *Q: The spec fails fast if `LOCAL_API_URL` isn't
  reachable, with an explicit setup message, rather than letting the
  walk proceed and treating every resulting network failure as "noise."*
  *Why is that distinction important given the test already tolerates
  console-error noise?* — Because a totally unreachable backend doesn't
  produce *interesting* noise to tolerate — it produces uniform,
  wall-to-wall failure that would make every single action a no-op
  against a data-less app, exactly the failure mode that made the
  pre-fix version of this test pass ("no crashes") while proving nothing
  at all. Failing fast with a clear message turns "the test silently
  proved nothing" into "the test refuses to run and says why," which is
  strictly more useful to whoever's running it.

---

## Config files

### `index.html`, `vite.config.ts`

Both already covered in full: `index.html` in the Entry point and app
shell section, `vite.config.ts` in `api/axiosInstance.ts`'s Watch out for
(the `/api`/`/media` dev-server proxy that both `axiosInstance.ts` files'
absolute `127.0.0.1:8000` fallback bypasses in local dev).

### `vitest.config.ts`

A **separate** config object from `vite.config.ts`, not a merge of it
(`defineConfig` called fresh, only re-adding the `@vitejs/plugin-react`
plugin) — `test.environment: "jsdom"`, `test.globals: true` (so
`describe`/`it`/`expect` are ambient, matching every test file's lack of
explicit Vitest imports for those three — though every test file in this
codebase *does* still explicitly import `describe`/`it`/`expect`/`vi`
from `"vitest"` rather than relying on the globals, which somewhat
undercuts the point of `globals: true` — **verified** by the consistent
import style across every `*.test.ts(x)` file read in this pass),
`test.setupFiles: "./src/test/setup.ts"`, and an explicit `test.exclude`
that adds `e2e/**` on top of Vitest's own defaults — necessary because
`e2e/monkey-test.spec.ts` uses Playwright's `test`/`expect`, not
Vitest's, and would otherwise be picked up and fail to even parse
correctly under Vitest's runner. **Watch out for:** matching audit item
P3-27, this file isn't included in either `tsconfig.app.json` or
`tsconfig.node.json`'s `include` arrays (only `vite.config.ts` is, via
`tsconfig.node.json`) — so this file's own TypeScript isn't checked by
`tsc -b` the way `vite.config.ts` is, and `globals: true` has no matching
`"types": ["vitest/globals"]` compiler option anywhere, meaning the
ambient globals it enables aren't actually typed for any file that
*does* rely on them implicitly.

### `src/test/setup.ts`

**Unverified in full** — not read directly in this pass; referenced by
`vitest.config.ts`'s `setupFiles`, so it runs once before the whole test
suite (the conventional place for jsdom polyfills, global `vi.mock`
calls, or Testing Library's `@testing-library/jest-dom` matcher
registration — confirming any of that requires reading the file
directly).

### `playwright.config.ts`

Covered in the `e2e/` section above for its `LOCAL_API_URL`-forcing
purpose. Separately: `retries: 1` and `reuseExistingServer:
!process.env.CI` are both **already correct** in the current file — the
audit's P3-09 finding (`trace: "on-first-retry"` never capturing because
retries defaulted to 0, and `reuseExistingServer: true` being
unconditional even in CI) describes an **older** version of this file;
the current one sets `retries: 1` (so a first-retry trace can actually
be captured) and gates `reuseExistingServer` on `!process.env.CI`
specifically so CI never silently reuses a stray leftover process — both
with their own explanatory comments in the file itself. **Verify against
the current file, not the audit report, if asked about this.**

### `biome.json`

Governs both lint and format (`npm run lint` is literally `biome check
.`) for the whole `tresse_frontend` package. `vcs: {enabled: true,
clientKind: "git", useIgnoreFile: true}` makes Biome respect
`.gitignore`. `files.includes: ["**", "!!**/dist"]` — the double-bang is
**valid Biome 2 syntax**, not a typo: a single `!` excludes a path, and a
second `!` on top of that force-*includes* it again even if a broader
pattern would otherwise have excluded it — here it's a plain exclusion of
`dist`, and the audit's claim that Biome's negation is "a single `!`"
(flagging this as a mistake, P3-10) doesn't hold up against Biome 2's
actual glob semantics. **Watch out for — this file is also at the center
of a real, currently-unresolved local tooling problem, unrelated to its
own contents:** this file declares no `"root"` field, and Biome 2's
config resolution — walking upward from wherever it's invoked, using the
git-repository root (found via the `vcs` setting) as an implicit
workspace boundary when no `biome.json` exists there — treats the
monorepo's git root (`TRESSE/`, one level above `tresse_frontend/`, where
no `biome.json` exists) as an *implicit root configuration*, and then
refuses to also treat *this* file as a root config, since it's nested
underneath that implicit one: `Found a nested root configuration, but
there's already a root configuration.` This fires specifically when
Biome is invoked with its working directory at the git root (exactly
what the repository's Husky `pre-commit` hook does, since it runs
`tresse_frontend/node_modules/.bin/biome check --write` from the repo
root) — running Biome from *inside* `tresse_frontend/` directly (e.g.
`cd tresse_frontend && npx biome check`, which is what `npm run lint`
and CI's `Lint with Biome` step both do, since CI sets `working-directory:
tresse_frontend`) does not hit this at all. **Unverified** whether this
has been fixed by the time this guide is read — it was an open,
reproduced problem as of this pass (confirmed by directly invoking Biome
both ways and observing the difference), affecting only the local
pre-commit hook, not CI or `npm run lint`.

### `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`

Three files forming what's normally a Vite project-references setup —
`tsconfig.app.json` (the real app compiler options: `strict`,
`noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`,
targeting `src`) and `tsconfig.node.json` (the same strictness, for
`vite.config.ts` alone) are each meant to be referenced from a slimmer
root `tsconfig.json` via a `"references"` array, with `tsc -b` building
both. **Watch out for:** the root `tsconfig.json` in this repo has
**no** `references` field at all — it instead declares its own full
`compilerOptions` (a smaller set: no `noUnusedLocals`,
no `noUnusedParameters`, no `noFallthroughCasesInSwitch`) and its own
`include: ["src"]`, completely independently of the two files that would
normally be the actual source of truth. This orphans
`tsconfig.app.json`/`tsconfig.node.json` — nothing references them, so
their stricter options never actually run — and it's exactly why dead
identifiers like `Help.tsx`'s `_PROFILE_PATH` (confirmed still present,
unused, in the current file) and the historical `FAQ.tsx` `_initialOpenId`
(removed as part of the P1-06/shipping-copy rewrite, per that commit's
diff, though **not** because anything caught it as unused — it was
removed incidentally while rewriting the surrounding code) survive:
`npx tsc --noEmit` (the command this project's own fix workflow runs,
confirmed across multiple fixes-documentation entries) type-checks
against the root `tsconfig.json` alone, which never enables the
unused-variable checks that would have flagged either. Matches audit item
P2-04 exactly.

### `package.json`

15 runtime dependencies, 18 dev dependencies. Runtime highlights already
covered elsewhere: `@reduxjs/toolkit`/`react-redux` (state),
`react-router-dom` (routing), `axios` (HTTP), `@stripe/stripe-js`/
`@stripe/react-stripe-js` (checkout, lazy-loaded per `App.tsx`'s
`OrderRouteWithStripe`), `react-hook-form`/`yup`/
`@hookform/resolvers` (every form in `components/`). Scripts: `dev`
(`vite`), `build` (`vite build` — **notably not** `tsc -b && vite build`,
so a production build does not type-check as a build step; type errors
are only caught by the separate `npx tsc --noEmit` this project's own fix
workflow runs by convention, not by `npm run build`/CI's build step
itself), `test`/`test:run`/`test:coverage` (Vitest), `test:e2e`
(all Playwright specs — currently just the one), `test:monkey` (that one
spec by itself), `lint` (`biome check .`), `prepare` (`husky`, wiring up
the git hooks directory on `npm install`). The `lint-staged` config
(referenced by the Husky `pre-commit` hook, not shown as its own script
here) runs Biome against staged files before every local commit — see
`biome.json`'s section above for the current state of that hook.

---

## Backend — newsletter

The rest of this guide documents `tresse_frontend/src` and cites backend
files in passing. This section and the next instead read
`tresse_backend/newsletter/` and `tresse_backend/templates/emails/`
directly, file by file, at the same evidence bar as everything above —
because two of the frontend's own sections (`utils/newsletter.ts`,
`view/NewsletterUnsubscribe.tsx`) call directly into this app and
deserve the backend counterpart spelled out rather than left as a name
in a "Backend:" line.

`newsletter/` is small — nine source files plus one migration — and
backs exactly two endpoints, both mounted at `/api/newsletter/`
(`tresse/urls.py`): `POST subscribe/` and `POST unsubscribe/<token>/`.

### `newsletter/models.py`

One model, `NewsletterSubscriber`: a unique `email`, an `is_active`
boolean (default `True`) that is the entire on/off switch for whether a
welcome/notification email would ever go to this address again, a
`source` `CharField` (max 32, default `"unknown"`, annotated in a code
comment as `"modal" | "footer" | ...` but **not** constrained to that set
by anything at the model or serializer layer — see `serializers.py`
below), and `created_at`/`updated_at`. `Meta.ordering = ["-created_at"]`
(newest first, matching the admin's default list order). `__str__`
returns the email.

**Watch out for:** `email`'s `unique=True` is the only thing standing
between this table and duplicate rows — `SubscribeAPIView` relies on it
existing for `get_or_create(email=...)` to behave as a true
get-or-create rather than risk a race creating two rows for the same
address (see that view's own Interview questions below for how a
genuine concurrent-request race actually plays out).

### `newsletter/migrations/0001_initial.py`

The only migration this app has — it creates the table above and
nothing else has changed shape since. If a future change adds a field
here, this is also the file that tells you what the *original* shape
was, since there's no second migration to diff against.

### `newsletter/serializers.py`

`NewsletterSubscribeSerializer`: `email` (`EmailField`, required),
`source` (`CharField`, `required=False`, `allow_blank=True`,
`max_length=32`). Used only by `SubscribeAPIView` — there's no
serializer for unsubscribe, since that endpoint takes its only input
(the signed token) from the URL, not the request body. This is a
write-only validation boundary, not a DTO: nothing here shapes a
response.

**Watch out for:** validation stops at "is this a well-formed email" and
"is `source` a string ≤ 32 chars" — neither field is normalized here.
`SubscribeAPIView` does its own `.lower().strip()` on `email` and
`.strip()[:32] or "unknown"` on `source` *after* this serializer has
already validated them, so the serializer's own `max_length=32` on
`source` and the view's redundant `[:32]` slice are two independent
belts on the same one strap — harmless, but worth noticing when asked
"where exactly does normalization happen."

### `newsletter/throttles.py`

`NewsletterAnonThrottle(AnonRateThrottle)`, `scope = "newsletter_anon"`.
The rate itself lives in `tresse/settings.py`'s `DEFAULT_THROTTLE_RATES`
as `config("THROTTLE_NEWSLETTER_ANON", default="5/min")` — this file
only names the bucket. Added in [[P0-05]]: before it, `SubscribeAPIView`
had no rate limiting or captcha at all, unlike every other public
`accounts` endpoint (register, login, reset, restore), so a script could
loop third-party addresses against it freely.

**Watch out for:** both `SubscribeAPIView` *and* `UnsubscribeAPIView` use
this exact same throttle class and scope, and DRF's `AnonRateThrottle`
keys its cache bucket on scope **and** client IP, not on scope + view —
so one IP's 5-per-minute budget is a single shared pool across
subscribing and unsubscribing both, not five of each.

### `newsletter/tokens.py`

The signed unsubscribe token — added in [[P0-06]] specifically so a
one-click unsubscribe link could exist at all (`is_active` previously
had no way to become `False` short of an admin editing the row by
hand).

- **`make_unsubscribe_token(email)`**: normalizes the email
  (`.lower().strip()`) and signs it with `django.core.signing.dumps`
  under the module-level salt `UNSUBSCRIBE_SALT = "newsletter.unsubscribe"`.
  Signing here is **tamper-evident, not encryption** — the email is
  recoverable from the token by anyone (it's a base64-encoded value plus
  an HMAC signature), just not *alterable* without invalidating the
  signature. The salt exists to namespace this specific use of
  `signing.dumps` against Django's shared `SECRET_KEY`, so a signature
  produced for some unrelated purpose elsewhere in the app (if one ever
  used `signing.dumps` with a different salt) couldn't be replayed here,
  and vice versa.
- **`read_unsubscribe_token(token)`**: `signing.loads` with the same
  salt and `max_age=UNSUBSCRIBE_TOKEN_MAX_AGE` — 30 days by default
  (`getattr(settings, "NEWSLETTER_UNSUBSCRIBE_TOKEN_MAX_AGE", 60*60*24*30)`).
  Raises two distinct exceptions the caller is expected to catch
  separately: `signing.SignatureExpired` for a token past its `max_age`,
  `signing.BadSignature` for one that's tampered with or simply
  malformed — `UnsubscribeAPIView` (below) turns these into two
  differently-worded 400 responses ("expired" vs. "invalid") rather than
  one generic error.
- **`build_unsubscribe_url(email)`**: `{FRONTEND_URL}/newsletter/unsubscribe/{token}/`
  — a **frontend** route, not a backend one. The backend's own matching
  endpoint (`newsletter/urls.py`, below) happens to accept a `<token>` at
  the identical path shape under `/api/newsletter/unsubscribe/<token>/`,
  but the two URL spaces are stitched together purely by this function
  and `App.tsx`'s route table agreeing on the same shape independently —
  there's no shared routing config between the two codebases enforcing
  it.

**Why the token encodes the subscriber's email instead of a raw
database id (the module's own docstring states this explicitly):** an
id-based token could be forged or walked by an attacker who only needs
to guess or increment a small integer to unsubscribe *someone else's*
address — signing an opaque id proves nothing about which address the
signer intended. Encoding the actual email means forging a token for a
different address requires producing a valid signature for that exact
string, which requires `SECRET_KEY`.

**Watch out for:** `signing.dumps`/`loads` sign against Django's global
`SECRET_KEY` by default — this file passes no explicit key, so rotating
`SECRET_KEY` (a normal incident-response step, e.g. after a leak)
silently invalidates every unsubscribe link already sent in every past
newsletter email; a subscriber clicking one afterward would see the
generic **"invalid"** message (`BadSignature`), not "expired," which
could read as a bug report rather than an expected side effect of a key
rotation someone else on the team performed (**unverified against this
file's own code** — this is standard `django.core.signing` behavior,
not a claim about anything this module does differently). There is also
no way to invalidate one single outstanding token early — e.g. if a
subscriber asked for their data to be removed before the 30-day window
naturally lapses — short of rotating the key for everyone.

### `newsletter/urls.py`

```
subscribe/                -> SubscribeAPIView    (name: newsletter_subscribe)
unsubscribe/<str:token>/  -> UnsubscribeAPIView  (name: newsletter_unsubscribe)
```

Included at `api/newsletter/` by `tresse/urls.py`, matching
`utils/newsletter.ts`'s `POST /newsletter/subscribe/` and
`view/NewsletterUnsubscribe.tsx`'s `POST /newsletter/unsubscribe/<token>/`
once `api/axiosInstance.ts`'s `baseURL` (which already ends in `/api`)
is prefixed on the frontend side.

### `newsletter/views.py`

**`SubscribeAPIView`** (`AllowAny`, `NewsletterAnonThrottle`):
1. Validates the body with `NewsletterSubscribeSerializer`.
2. Normalizes `email` (`.lower().strip()`) and `source`
   (`.strip()[:32] or "unknown"`).
3. `NewsletterSubscriber.objects.get_or_create(email=email, defaults={"source": source, "is_active": True})`.
4. If the row already existed: `reactivated` starts `False`; if it was
   `is_active=False`, flips it to `True` and sets `reactivated = True`;
   if `source` differs from what's stored, updates that too
   (independent of the reactivation branch); saves with
   `update_fields=["is_active", "source", "updated_at"]` **only if
   something actually changed** — a repeat POST with identical data
   triggers no write at all.
5. Any `IntegrityError`/`DatabaseError` from that block returns 500,
   with the raw exception string included in the response **only when
   `settings.DEBUG` is true** — the same DEBUG-gated-detail pattern
   `UnsubscribeAPIView` (below) also uses, so a production error can't
   leak internals but a local `DEBUG=True` run stays easy to diagnose.
6. **The email is sent only `if created or reactivated`** — this is the
   guard [[P0-05]] added. Before it, the welcome email fired on *every*
   POST unconditionally, including a second, third, or hundredth POST
   for an address that was already active. Combined with
   `SubscribeAPIView` having no throttling at the time, that meant a
   script (or just a form double-submitted by a slow double-click) could
   trigger real outbound mail from the store's own sending domain to a
   real inbox on every repeat request — a spam-complaint and
   deliverability risk against the domain `DEFAULT_FROM_EMAIL` sends
   from (`support@tresseknitting.com`, via the Resend backend configured
   in `tresse/settings.py`'s `ANYMAIL`/`EMAIL_BACKEND`), not just a
   wasted request. Gating on "genuinely new, or coming back from
   inactive" means the welcome email means exactly what it says: this
   address is joining (or rejoining) the list right now, not "someone
   POSTed this form again."
7. When the guard passes: builds the render context
   (`email`, `source`, `brand: "TRESSE"`, `unsubscribe_url` from
   `tokens.build_unsubscribe_url(email)`), renders both
   `emails/accounts/newsletter_welcome.txt` and `.html`, and sends an
   `EmailMultiAlternatives` (plain text body, HTML attached as the
   alternative) with `reply_to` set to `SUPPORT_EMAIL` (falling back to
   `from_email` if unset). This whole block has its **own**
   `try/except Exception`, separate from the DB block above — a
   template error or an email-provider outage never rolls back or fails
   the subscription itself; it only flips the `email_sent` flag in the
   response body to `False` and logs the exception.
8. Responds `201` (created) or `200` (not created) with
   `{ok, created, email, email_sent}`.

**`UnsubscribeAPIView`** (`AllowAny`, `NewsletterAnonThrottle`):
1. `tokens.read_unsubscribe_token(token)` → the email, or a `400` with a
   specific `detail` for `SignatureExpired` ("This unsubscribe link has
   expired.") vs. `BadSignature` ("This unsubscribe link is invalid.").
2. Looks the subscriber up by that email; `None` → `400` "Subscriber not
   found."
3. If found and currently active, flips `is_active = False` and saves
   (`update_fields=["is_active", "updated_at"]`). If already inactive,
   this is a **no-op that still returns 200** — clicking an old
   unsubscribe link twice, or reloading the confirmation page, can't
   error or double-write.
4. Same DEBUG-gated DB-error handling as `SubscribeAPIView`.
5. Responds `200` with `{ok: true, email}`.

**What it talks to:** `NewsletterSubscriber`
(`models.py`), `NewsletterSubscribeSerializer`, `NewsletterAnonThrottle`,
`tokens.py`, `django.core.mail.EmailMultiAlternatives`, the two
`newsletter_welcome` templates (next section). Frontend:
`utils/newsletter.ts`'s `subscribeNewsletter` and
`view/NewsletterUnsubscribe.tsx`, both documented above.

**Watch out for:** the `reactivated` flag tracks only the
`is_active` transition — if an already-active subscriber POSTs again
with a *different* `source` value, the row's `source` is updated
silently and the email guard still skips sending (correctly, since
nothing about their subscription status changed), which means a
source-only correction is invisible unless someone checks the admin
list. Separately, `source` is free text from an anonymous, throttled
(but unauthenticated) endpoint — nothing enforces the documented
`"modal"`/`"footer"`/`"unsubscribe"` set beyond what the frontend
happens to send; a client could POST any ≤32-character string, which
would just be noise in the admin's `source` filter, not a security
issue.

**Interview questions:**
- *Q: Why does POSTing to `/newsletter/subscribe/` for an address that's
  already active, with the same `source` it already has, return `200`
  with `email_sent: false` instead of `201`?* — `get_or_create`'s
  `created` is `False` since the row already exists; since nothing about
  the row actually changed, the conditional save doesn't run either;
  because neither `created` nor `reactivated` is `True`, step 6's guard
  skips sending — exactly [[P0-05]]'s intent, that a repeat submission
  for someone already on the list is a no-op, not a resend.
- *Q: Why does a successful unsubscribe return `200` even when the
  subscriber was already inactive, rather than distinguishing "you were
  already unsubscribed" from "you're unsubscribed now"?* — Unsubscribing
  is meant to be idempotent from the caller's point of view:
  `view/NewsletterUnsubscribe.tsx` just needs "yes, this address is off
  the list" to render its success state, and a customer clicking an old
  link a second time (browser back button, a slow mail client
  double-loading the page) shouldn't see a different, more alarming
  outcome the second time.
- **Harder follow-up:** *Q: Two `POST /newsletter/subscribe/` requests
  for the exact same brand-new address arrive close enough together to
  race. Walk through what actually happens, and why the view's own
  `try/except (IntegrityError, DatabaseError)` around the `get_or_create`
  call is unlikely to be what handles it.* — Django's `get_or_create`
  already handles this internally: it first attempts the `INSERT`, and
  if that raises `IntegrityError` against the unique `email` constraint
  (because the other request's `INSERT` won the race), it catches that
  specific error itself and retries with a plain `get()`, returning the
  now-existing row with `created=False`. The view's own broad
  `except (IntegrityError, DatabaseError)` block is there for a
  *different* class of failure — a genuine database outage or
  connectivity error during the call — not for this ordinary
  create/create race, which resolves one level lower, inside the ORM,
  before it would ever reach the view's own exception handler.

---

## Backend — email templates

Every plain-text or HTML email this backend sends through a Django
template lives under `tresse_backend/templates/emails/`, grouped into
three folders that roughly match the apps that send them:
`accounts/` (auth and newsletter mail), `orders/` (checkout, shipping,
returns), `products/` (back-in-stock). Two email-sending helper modules
— `products/emails.py`'s `send_cart_reminder_email` and
`send_wishlist_reminder_email` — build their message bodies as plain
f-strings instead of a template file at all; they're mentioned here for
completeness but have no corresponding file in this directory.

### `templates/emails/accounts/`

- **`welcome.txt`** — sent by `accounts/emails.py`'s
  `send_account_welcome_email(user_id)`, called from
  `RegisterAPIView.post` (`accounts/views.py`) via
  `transaction.on_commit`, right after a new account is created.
  Context: `name` (first + last name, falling back to the email
  address), `frontend_url`, `support_email`. Hardcodes the `TRESSE15`
  welcome promo code directly in the copy — the same code
  `view/Order.tsx` looks for order history to decide whether to display
  (per [[P1-02]] in the frontend fixes documentation), so this template
  and that frontend check have to agree on the literal string
  `"TRESSE15"` with nothing in code enforcing that they do. Covered by a
  real (non-mocked) render in `accounts/tests.py`'s
  `AccountEmailTemplatesRenderTestCase.test_welcome_renders`.
- **`account_deactivated.txt`** — sent by `send_account_deleted_email`,
  called from `DeleteAccountAPIView.post` (`accounts/views.py`) after a
  self-service account deactivation (soft delete: `is_active=False`,
  `deleted_at` set, password made unusable, profile address fields
  cleared). Context: `first_name`, `support_email`, `help_url`,
  `restore_url` (built only if the user has an email on file — empty
  otherwise, and the template's `{% if restore_url %}` block hides the
  restore link entirely in that case), `restore_window_days`
  (`settings.ACCOUNT_RESTORE_WINDOW_DAYS`, default 30). Also covered by
  a real render test
  (`AccountEmailTemplatesRenderTestCase.test_account_deactivated_renders`).
- **`account_restore.txt` — a live, currently-broken template
  reference, found by direct render, not by reading the fix docs:**
  intended to be sent by `send_account_restore_email`, called from
  `AccountRestoreRequestAPIView.post` whenever a deactivated account's
  owner asks to restore it (and the account is still inside the restore
  window). The function calls
  `render_to_string("emails/accounts/account_restore.txt", ...)` — but
  the actual file on disk is named `account_restore.txt ` **with a
  trailing space** (confirmed with `os.listdir`, and by directly calling
  `render_to_string` against this project's real templates, which raises
  `TemplateDoesNotExist: emails/accounts/account_restore.txt`). Because
  `send_account_restore_email`'s entire body is wrapped in a bare
  `try/except Exception: logger.exception(...)`, this failure is
  swallowed silently every single time: the view still returns its
  generic "if an account exists, a restore link has been sent" message,
  `transaction.on_commit` still fires, nothing about the request looks
  wrong from the outside — but **no restore email has ever actually been
  sent by this code path**, only an exception logged server-side. This
  is invisible to the test suite for the same reason the newsletter
  greeting bug ([[P1-08]] in `docs/fixes-2026-09.md`) was: every test
  that exercises this flow
  (`accounts/tests.py`'s three tests patching
  `"accounts.views.send_account_restore_email"`) mocks the function
  entirely, and — unlike `welcome.txt` and `account_deactivated.txt` —
  `AccountEmailTemplatesRenderTestCase` has no real-render test for this
  specific template, so nothing ever actually calls `render_to_string`
  against the real file in CI. Would-be context (never reached in
  practice): `first_name`, `restore_url`, `support_email`, `help_url`.
- **`email_verification.txt` — unused.** No Python file in this
  codebase references `"emails/accounts/email_verification.txt"` or
  calls anything resembling a verification-email sender (confirmed by a
  repo-wide grep for the path and for `email_verification`) — there is
  no email-verification feature wired up anywhere; this template appears
  to be leftover scaffolding for a feature that was never built, or was
  removed without deleting the template.
- **`password_reset.txt` — unused, for a more surprising reason:**
  `PasswordResetRequestAPIView.post` (`accounts/views.py`) does send a
  real password-reset email, but builds its subject and body as plain
  strings inline (`message = f"Click the link below to reset your
  password:\n\n{reset_link}"`) and calls `send_mail` directly — it never
  calls `render_to_string` at all, so this template file, despite living
  right alongside the templates that *are* used for the equivalent
  accounts flows, is never rendered by anything. A reader following only
  `templates/emails/` would reasonably assume this is the password-reset
  email; it isn't.
- **`newsletter_welcome.txt` / `newsletter_welcome.html`** — covered in
  depth in the `newsletter/views.py` write-up above (`SubscribeAPIView`).
  Worth repeating here only because it's the one template in this folder
  with **two** files (plain text and HTML) sent together as
  alternatives in one `EmailMultiAlternatives` message, unlike every
  other email in this codebase, which sends plain text only.

### `templates/emails/orders/`

All six templates in this folder are used, each from exactly one
call site in `orders/emails.py`, itself called from either
`orders/views_stripe.py` (the Stripe webhook) or an admin action in
`orders/admin.py`/`orders/views.py`:

| Template | Sent by | Triggered from |
|---|---|---|
| `order_confirmation.txt` | `send_order_confirmation_email` | `stripe_webhook`'s `checkout.session.completed` handler, right after an `Order` is created (`views_stripe.py`) |
| `order_canceled.txt` | `send_order_canceled_email` | `CancelOrderAPIView.post` (`orders/views.py`), once a customer-initiated cancel's refund is recorded |
| `refund_initiated.txt` | `send_refund_initiated_email` | `CancelOrderAPIView.post` only — **not** sent from the admin's return-refund action (see the return walkthrough below) |
| `shipping_confirmation.txt` | `send_shipping_confirmation_email` | the admin's "Mark selected orders as shipped" action (`orders/admin.py`'s `mark_shipped`) |
| `delivered.txt` | `send_delivered_email` | the admin's "Mark selected orders as delivered" action (`orders/admin.py`'s `mark_delivered`) |
| `checkout_stock_sold_out.txt` | `send_checkout_stock_sold_out_email` | `stripe_webhook`, when a paid checkout's stock re-check fails and the charge is refunded in full (`_refund_stock_sold_out_checkout`, `views_stripe.py`) |

Every one of these renders `order` (the model instance itself, not a
dict — templates read `order.full_name`, `order.public_id`, etc.
directly) plus `support_email`/`support_url` from `orders/emails.py`'s
shared `_support_context()` helper; `order_confirmation.txt` alone also
receives `items` (a list of plain dicts built by `_build_items_payload`,
not `OrderItem` instances). All six use `order.public_id` with a
`{% if %}` fallback to `#{{ order.id }}` if it's unset — added in
[[P1-09]] after the subject line and body used to disagree (subject
showed the public `TR-...` id, body showed the internal primary key).

**Watch out for:** `checkout_stock_sold_out.txt`'s subject in code is
`"TRESSE — Your payment was refunded"`, but the template body's own
first line is literally `"Payment Refunded"` — consistent with each
other, just worth noting since it's the one template in this folder
whose in-template heading doesn't restate the order number the way
every other template in this folder does (there is no order at this
point — the whole reason this email exists is that one was never
created).

### `templates/emails/products/`

- **`back_in_stock.txt`** — sent by `products/emails.py`'s
  `send_back_in_stock_email`, called from `products/signals.py`'s
  `notify_when_back_in_stock` — the `post_save` signal on `ProductSize`
  that detects a genuine zero-to-positive restock (see the back-in-stock
  walkthrough below for the full mechanism and its own history of bugs,
  [[P0-01]]/[[P0-02]]). Context: `product_name`, `product_url`
  (`{FRONTEND_URL}/product/{id}`), `support_email`. The only template in
  this folder, and the only email-sending code path in the whole backend
  that's wired through a Django signal rather than called directly from
  a view or admin action.

---

## Backend — accounts

Continuing the same file-by-file pass as the `newsletter`/email-templates
sections above, now over `tresse_backend/accounts/` — the app that owns
the `User` model, registration, login, password reset, the self-service
account-deactivation/restore flow, and the shipping-address profile.
Several frontend files call directly into it (`api/auth.ts`,
`api/account/ChangePassword.ts`, `components/Authorization.tsx`,
`components/Register.tsx`, `components/AccountRestore.tsx`,
`components/PasswordResetConfirm.tsx`, `components/PasswordChange.tsx`,
`view/Dashboard.tsx`) and this section cross-references each by path
rather than repeating what's already documented above.

### `accounts/models.py`

**What it is:** `UserManager` (a custom `BaseUserManager`), `User` (a
custom `AbstractBaseUser`/`PermissionsMixin`, email-based rather than
Django's default username-based model), and `UserProfile` (a one-to-one
shipping-address record).

**Why it exists:** Email-based login needs a custom user model —
Django's built-in `User` is username-first. Soft delete lives directly on
`User` itself (`is_active`/`deleted_at`) rather than a separate table, and
the shipping address is split out into `UserProfile` so `User` stays
about identity/auth only.

**What it exports:** `UserManager`, `User`, `UserProfile`.

**How it works:**
- **`UserManager.create_user(email, phone_number, password, first_name,
  last_name, **extra_fields)`**: raises a plain `ValueError` (not a DRF
  validation error) if `email`, `phone_number`, or either name is falsy —
  this method runs at the model/manager layer, independent of any web
  framework, so it's the last-resort invariant, not the primary
  validation path (see `RegisterSerializer`, below, for the HTTP-facing
  check). Normalizes `email` (`self.normalize_email(...).strip().lower()`)
  and strips `phone_number`/both names, hashes the password via
  `set_password`, saves.
- **`create_superuser(email, password, **extra_fields)`**: defaults
  `is_staff`/`is_superuser`/`is_active` to `True` and — only if not
  already supplied — `phone_number` to `"0000000000"`,
  `first_name`/`last_name` to `"Admin"`/`"User"`, so a purely
  programmatic call (a script, a data migration) doesn't need to invent
  values for fields it doesn't care about. Normalizes email the same way.
- **Fields:** `email` (`EmailField`, `unique=True`); `phone_number`
  (`CharField`, max 15, **not** unique today — see the migrations section
  below for how that changed); `first_name`/`last_name` (`CharField`, max
  30); `is_email` (`BooleanField`, default `False` — see Watch out for);
  `is_active`/`is_staff`; `date_joined` (`auto_now_add`); `deleted_at`
  (nullable `DateTimeField`) — the one field the restore-window logic in
  `accounts/views.py` (`RESTORE_WINDOW_DAYS`) reads to decide whether a
  restore link is still inside its window. `groups`/`user_permissions`
  redeclare `PermissionsMixin`'s default M2M fields purely to give them
  non-clashing `related_name`s (`custom_user_groups`/
  `custom_user_permissions`) — required whenever `AbstractBaseUser` +
  `PermissionsMixin` is used directly instead of `AbstractUser`, since
  `auth.Group`/`auth.Permission` already point a `related_name` at the
  stock `auth.User` model.
- `USERNAME_FIELD = "email"`, `REQUIRED_FIELDS = ["phone_number",
  "first_name", "last_name"]` — read by `manage.py createsuperuser`'s
  interactive prompts and the Django admin, not by the DRF login flow
  itself (that uses `CustomTokenObtainPairSerializer`'s own
  `username_field` override — see `serializers.py` below).
- **`mark_deleted()`**: sets `is_active=False`, `deleted_at=timezone.now()`,
  and calls `set_unusable_password()` — Django's mechanism for a password
  hash that can never match any input, distinct from an empty string —
  then saves exactly those three fields. Called from `DeleteAccountAPIView`
  (self-service deactivation). There is no hard-delete/data-erasure path
  anywhere in this codebase — the row and its order history are retained
  indefinitely.
- **`restore(new_password=None)`**: sets `is_active=True`,
  `deleted_at=None`; if given a password, also hashes and saves it. Used
  directly only by the model-level tests
  (`accounts/tests.py`'s `UserSoftDeleteTestCase`) — the real HTTP restore
  endpoint, `AccountRestoreConfirmAPIView`, does **not** call this method;
  it inlines the same three-field assignment itself instead (see
  `views.py`'s Watch out for below).
- `__str__`: `"{email} ({phone_number})"`.

**`UserProfile`**: one-to-one to `User` (`related_name="profile"`);
`address_line1`/`apartment`/`city`/`state`/`postal_code`/`country`, all
`CharField(blank=True, default="")` — never `null`, so an unset address
field always reads as `""`, never `None`, anywhere downstream; `updated_at`
(`auto_now`), no `created_at` at all. Nothing creates a `UserProfile` at
registration time — `ProfileAPIView` (`views.py`) `get_or_create`s one
lazily on first `GET`/`PUT`, so a brand-new user has zero `UserProfile`
rows until they first hit `/accounts/profile/`.

**What it talks to:** Django's `auth.Group`/`auth.Permission` (via
`PermissionsMixin`). Read by `accounts/serializers.py`,
`accounts/views.py`, `accounts/admin.py`, `orders/models.py` (the `Order.user`
foreign key), `products/models.py` (`Cart.user`,
`ProductWishlist.user`, `StockSubscription.user`).

**Watch out for:**
- **`is_email` looks like dead scaffolding.** It's named as if it tracks
  "has this user verified their email address," but nothing in
  `accounts/views.py`, `serializers.py`, `emails.py`, or `urls.py` ever
  reads or writes it (confirmed by grep across the app) — there is no
  email-verification flow in this codebase at all. This lines up with the
  frontend guide's own finding that `templates/emails/accounts/
  email_verification.txt` is likewise unused: the two look like leftover
  pieces of the same never-built (or removed) feature.
- **`phone_number`'s uniqueness has flipped twice.** Migration `0002`
  made it `unique=True` (with a `RunPython` step backfilling a dummy value
  for any null rows first); migration `0006` dropped that constraint back
  to a plain, non-unique `CharField` — matching the model as it reads
  today. Two different users can share a phone number right now.
- **`mark_deleted()`/`restore()` are not the only code paths that do
  this.** `DeleteAccountAPIView` does call `mark_deleted()`, but
  `AccountRestoreConfirmAPIView` inlines its own
  `is_active = True; deleted_at = None; ...; save(update_fields=[...])`
  rather than calling `restore()`. Both end up setting the same fields
  today, so this is duplication rather than a behavioral gap — but the
  two paths could silently drift if `restore()` ever grew a new side
  effect the view wouldn't automatically pick up.

**Interview questions:**
- *Q: Why does `UserManager.create_user` raise a plain `ValueError` for a
  missing email/phone/name instead of something DRF-shaped?* — Because
  this method runs at the model/manager layer, which Django uses
  independent of any web framework (`createsuperuser`, a data migration,
  a one-off script) — `RegisterSerializer`'s own field validators are
  what turn "empty string" into a proper `400` response before
  `create_user` is ever reached from the API; the manager's `ValueError`
  is a last-resort invariant, not the primary validation path.
- *Q: Why is `deleted_at` nullable and separate from `is_active`, instead
  of relying on `is_active` alone to mean "deleted"?* — `is_active`
  already has an older, independent meaning in Django (auth backends
  refuse to authenticate an inactive user, regardless of why), and the
  restore-window policy needs a timestamp to measure 30 days against —
  `is_active` alone can say "can this user log in right now," not "when
  were they deactivated," which is exactly what `RESTORE_WINDOW_DAYS`
  needs to compare against.
- **Harder follow-up:** *Q: `mark_deleted()` calls
  `set_unusable_password()` instead of leaving the existing hash in
  place. Given the account is already `is_active=False` and can't log in
  anyway, what does that choice actually buy?* — `is_active=False` blocks
  authentication through the normal login flow, but it doesn't
  retroactively invalidate a JWT access token issued **before**
  deactivation — SimpleJWT tokens are self-contained and remain valid
  until their own expiry or an explicit blacklist entry (`INSTALLED_APPS`
  does include `rest_framework_simplejwt.token_blacklist`; **unverified**
  in this pass whether deactivation actually blacklists anything).
  Making the password hash unusable means that even if `is_active` were
  somehow bypassed, or the old password were guessed or leaked elsewhere,
  the deactivated account still cannot be logged into via password
  auth — `restore()` (or the equivalent inline code in
  `AccountRestoreConfirmAPIView`) is the only way back in, and it
  requires either setting a fresh password or the account already having
  a usable one restored some other way, so a deactivated account can
  never be silently reactivated by someone who merely knew the old
  password.

### `accounts/migrations/`

Six migrations, in order: `0001_initial` creates the custom `User` model
as it existed at the start (Django 5.1.5, per the header comment).
`0002` removes a since-abandoned `is_phone_number` field, makes both
`email` and `phone_number` `unique=True`, and backfills a
`RunPython(set_default_values)` for any pre-existing null rows before
tightening the constraint. `0003`/`0004` add and then re-type
`first_name`/`last_name`. `0005` creates `UserProfile`. `0006` adds
`deleted_at` and — the one change worth calling out on its own — **drops
`phone_number`'s `unique=True`** back to a plain `CharField`, reversing
what `0002` had added; this is the only place in the migration history
where a constraint was tightened and then deliberately loosened again,
and it's why `models.py` reads `unique=False` explicitly today rather
than leaving it implicit.

### `accounts/serializers.py`

**What it is:** `CustomTokenObtainPairSerializer` (login),
`RegisterSerializer`, `ChangePasswordSerializer`,
`PasswordResetRequestSerializer`, `PasswordResetConfirmSerializer`,
`ProfileSerializer` — every input/output validation boundary this app
uses, in one file (there's no `accounts/views.py`-side ad hoc validation
except the two account-restore views, which read raw `request.data`
directly rather than going through a serializer at all — see `views.py`
below).

**How it works, per class:**
- **`CustomTokenObtainPairSerializer(TokenObtainPairSerializer)`**: sets
  `username_field = "email"` so SimpleJWT's login accepts `email`+
  `password` instead of `username`+`password`. `validate()` lowercases
  and strips the incoming `email`, maps it onto SimpleJWT's expected
  `username`/`password` keys, calls `super().validate(attrs)` (which
  authenticates and issues the token pair), then explicitly re-checks
  `self.user.is_active` and raises a `ValidationError({"detail": "Account
  is deactivated. Please restore it via email."}` if it's `False` — this
  check is **redundant** with Django's own `ModelBackend`, which already
  refuses to authenticate an inactive user by default (so `super().validate`
  would typically have already failed before this line is ever reached);
  it exists to give that failure a specific, on-brand message pointing at
  the restore flow, rather than SimpleJWT's generic "No active account
  found with the given credentials" wording. On success, adds a
  `user: {id, email, first_name, last_name}` object into the response
  alongside SimpleJWT's standard `{access, refresh}` — this is what
  `authSlice.ts`'s `normalizeUser` (`tresse_frontend/src/utils/
  authSlice.ts`) reads its snake_case `first_name`/`last_name` from.
- **`RegisterSerializer(ModelSerializer)`**: `password`
  (`write_only`, `min_length=8`), `email` (`EmailField`), `phone_number`
  (`CharField`); `Meta.fields` also includes `first_name`/`last_name`
  from the model. `validate_email` rejects a case-insensitive duplicate
  (`User.objects.filter(email__iexact=email).exists()`) and normalizes
  the value. `validate_phone_number` just rejects an empty string after
  stripping — no format/pattern check at all (the frontend's own Yup
  schema, per the guide's `Register.tsx` entry, adds a phone-number regex
  client-side; nothing server-side enforces it). `validate_password` runs
  Django's `validate_password` (common-password/all-numeric/similarity
  checks, not just the `min_length=8` the field itself already enforces).
  `create()` re-normalizes email/phone (belt-and-suspenders against
  anything that bypassed the field validators) and calls
  `User.objects.create_user(...)`.
- **`ChangePasswordSerializer(Serializer)`**: `current_password`,
  `new_password` (`min_length=8`), `confirm_password` (`min_length=8`),
  all `write_only`. `validate()` checks `new_password == confirm_password`.
  `validate_new_password` runs `validate_password`. **`save(user)`** is a
  non-standard signature — a plain `Serializer` has no model to save
  against automatically, so this class defines its own `save` that takes
  the `user` explicitly as a parameter (`ChangePasswordAPIView` calls
  `serializer.save(user=user)`) rather than relying on DRF's usual
  `instance`/`create`/`update` machinery. It does **not** itself check
  `current_password` — that check lives in `ChangePasswordAPIView.post`,
  one layer up, since only the view has `request.user` available to
  check the password against.
- **`PasswordResetRequestSerializer(Serializer)`**: one field, `email`
  (`EmailField`) — pure shape validation; all the "does this user exist,
  is it active" logic lives in the view.
- **`PasswordResetConfirmSerializer(Serializer)`**: `uidb64`, `token`
  (both plain `CharField`), `new_password`/`confirm_password` (both
  `min_length=8`, `write_only`). Same match-check and
  `validate_password` pattern as `ChangePasswordSerializer`. Note this
  serializer has **no** `is_active` awareness at all — the deactivated-
  account refusal added for [[P0-04]] (in `docs/fixes-2026-09.md`) lives
  entirely in `PasswordResetConfirmAPIView`, not here.
- **`ProfileSerializer(Serializer)`**: nine fields
  (`first_name`/`last_name`/`email` from `User`;
  `address_line1`/`apartment`/`city`/`state`/`postal_code`/`country` from
  `UserProfile`), every one `required=False, allow_blank=True` — this is
  a flat, single serializer spanning two models, matching exactly what
  `ProfileAPIView.put` needs for a `partial=True` update where any subset
  of fields may be present. As of [[P1-04]] (in `docs/fixes-2026-09.md`),
  every field name here is the same snake_case the frontend's own
  `mapFormToApi`/`mapApiToForm` (`tresse_frontend/src/view/Dashboard.tsx`)
  already sent and expected — before that fix, `ProfileAPIView` (not this
  serializer, which was never the problem) read and wrote a mismatched
  set of camelCase keys server-side, so four of these nine fields were
  silently dropped on every save despite the frontend having always sent
  the right shape.

**What it talks to:** `accounts/models.py` (`User`), Django's
`validate_password` (`django.contrib.auth.password_validation`, governed
by `tresse/settings.py`'s `AUTH_PASSWORD_VALIDATORS`), SimpleJWT's
`TokenObtainPairSerializer`. Consumed by every view in `accounts/views.py`
except the two account-restore views.

**Watch out for:** three different serializers
(`ChangePasswordSerializer`, `PasswordResetConfirmSerializer`, and
`accounts/views.py`'s inline `validate_password` call for account
restore) each independently re-implement the identical
"`new_password`/`confirm_password` must match, then run
`validate_password`" pattern — there's no shared mixin or base class
factoring it out, so a future change to that rule (e.g. adding a
password-history check) would need to be applied in three separate
places by hand.

**Interview questions:**
- *Q: `CustomTokenObtainPairSerializer.validate` re-checks
  `self.user.is_active` right after calling `super().validate(attrs)`.
  Given Django's `ModelBackend` already refuses to authenticate an
  inactive user, when does this second check actually get to run?* —
  Only if something about `super().validate` in this specific SimpleJWT/
  Django version combination doesn't itself block an inactive user before
  returning — in the normal case, `ModelBackend.user_can_authenticate`
  already raises before this line is reached, making the explicit check
  effectively unreachable defensive code; it costs nothing to keep and
  gives a branded error message if that assumption ever stops holding
  (e.g. a custom auth backend swapped in later that doesn't check
  `is_active` itself).
- *Q: Why does `ChangePasswordSerializer.save` take `user` as an explicit
  argument instead of the serializer being constructed with
  `instance=user`?* — A plain `Serializer` (not a `ModelSerializer`) has
  no built-in notion of an instance to update — passing `user` into
  `save()` directly is simpler than wiring up `instance`/`update()` for a
  serializer that isn't really modeling `User` as a whole, just three
  password-related input fields.
- **Harder follow-up:** *Q: `RegisterSerializer.validate_phone_number`
  only rejects an empty string — no format check at all. Trace what
  actually stops a registration with, say, `phone_number: "abc"` from
  succeeding.* — Nothing does, server-side. `UserManager.create_user`
  only checks truthiness (`if not phone_number: raise ValueError(...)`),
  and the `User.phone_number` field itself is a plain, unconstrained
  `CharField`. The only thing standing between a malformed phone number
  and a saved row is the frontend's own Yup regex in
  `components/Register.tsx` — a request built by hand (or by any other
  client) bypassing that form would register successfully with
  `phone_number = "abc"`.

### `accounts/throttles.py`

`LoginAnonThrottle`/`LoginUserThrottle`, `RegisterAnonThrottle`/
`RegisterUserThrottle` — four small `AnonRateThrottle`/`UserRateThrottle`
subclasses, each naming one rate-limit bucket (`scope`). The actual rates
live in `tresse/settings.py`'s `DEFAULT_THROTTLE_RATES`
(`THROTTLE_LOGIN_ANON`, etc.). **Watch out for:** this exact same set of
four classes is **redefined again**, verbatim, inside `accounts/views.py`
itself (see below) — this module-level file appears to be unused by
anything in this app; `accounts/urls.py`'s views all reference the
classes declared directly in `views.py`, not these. **Unverified**
whether anything outside `accounts/` imports from this file; a repo-wide
grep for `from accounts.throttles import` or `from .throttles import`
inside `accounts/` itself would confirm whether it's dead code
duplicating four class names that already exist one file over.

### `accounts/middleware.py`

**What it is:** One middleware class, `AuthenticationMiddleware` (a
locally-defined class with the **same name** as Django's own
`django.contrib.auth.middleware.AuthenticationMiddleware` — a real,
easily-confusable naming collision; check `tresse/settings.py`'s
`MIDDLEWARE` list directly if it matters which one is actually installed
and in which order relative to the other).

**What it does:** Returns a bare `204` for `/favicon.ico` before anything
else runs, so a browser's automatic favicon request never reaches
Django's URL routing or authentication machinery at all. Otherwise, for
an unauthenticated (`AnonymousUser`) request whose path starts with
`/api/register`, `/api/login`, `/api/products`, or `/api/reviews`, it
calls straight through to `get_response(request)`. For every other
request — authenticated or not, and for an anonymous request to any
*other* path — it also just calls `get_response(request)`.

**Watch out for:** **the whitelist branch and the fallthrough do exactly
the same thing.** Both code paths end in `return self.get_response(request)`
(or the equivalent at the bottom of the function) — the `if` block adds
no actual short-circuit, no different response, no header, nothing
observably different from what would happen if this middleware were
deleted entirely and replaced with `return self.get_response(request)`
unconditionally. Whatever access control DRF's own `permission_classes`
per view is already doing (`AllowAny` on `RegisterAPIView`, `login`,
`ProductViewSet`, etc.) is the actual gate; this middleware's path
whitelist is inert. **Unverified** whether this was meant to *deny*
everything else (i.e., the intended logic was probably "if anonymous and
path is not in this whitelist, refuse" — the exact inverse of what's
written) and the condition was written backwards, or whether it's
leftover from an earlier design where the whitelist mattered and the
`else` branch used to differ; either way, reading this file top to bottom
gives no functional behavior beyond the `/favicon.ico` short-circuit.

**Interview question:** *Q: What would change, functionally, if this
entire class body were replaced with just `return self.get_response(request)`
for every request except `/favicon.ico`?* — Nothing — every branch
already resolves to exactly that call; the `isinstance(request.user,
AnonymousUser)`/path-prefix check is dead conditional logic that both of
its outcomes converge on the same line.

### `accounts/emails.py`

Three plain-text senders, each wrapped in its own
`try/except Exception: logger.exception(...)` so a template or SMTP
failure never propagates back to the caller: `send_account_welcome_email`
(registration), `send_account_deleted_email` (deactivation, with an
optional `restore_url` — the template hides its restore-link section
entirely if this is empty, per the frontend guide's own reading of
`account_deactivated.txt`), and `send_account_restore_email` (the
restore-request flow). **Cross-reference:** the frontend guide's
`Backend — email templates` section already documents
`account_restore.txt`'s **broken filename** in detail (a trailing space
on disk vs. the exact string this file's `render_to_string` call passes)
and the fact that no test in `accounts/tests.py` exercises this specific
function's real template render — every restore-flow test mocks
`send_account_restore_email` itself rather than letting it run, so the
broken reference is invisible to the suite. That finding is about this
exact function; it isn't repeated in full here.

### `accounts/admin.py`

**What it is:** `UserAdmin` (with `UserProfileInline` and a read-only
`OrderInline` from `orders.models.Order`) and `UserProfileAdmin`.

**How it works:** `UserAdmin.list_display` adds several computed columns
— `cart_items_count`, `cart_total`, `wishlist_items_count`,
`orders_count`, `orders_total` — each doing its own query per row (no
annotation on the changelist queryset itself), so the admin user list is
`N` extra queries per page, not one. Two bulk actions,
`send_cart_reminder`/`send_wishlist_reminder`, iterate the selected users
and call `products/emails.py`'s `send_cart_reminder_email`/
`send_wishlist_reminder_email` directly, skipping anyone with an empty
cart/wishlist and reporting sent/skipped/failed counts via
`self.message_user`.

**Watch out for:** `cart_total`'s per-item loop
(`product.price * item.quantity` for every `CartItem`) ignores
`custom_length_surcharge` entirely — unlike `CartItemSerializer`'s own
snapshot logic (see `products/serializers.py` below), which is what the
customer-facing cart total actually reflects. An admin looking at this
column for a cart containing a custom-length item would see a number
**lower** than what that customer would actually be charged at checkout.

### `accounts/urls.py`

```
register/                     -> RegisterAPIView              (name: register)
token/                        -> CustomTokenObtainPairView     (name: token_obtain_pair)
token/refresh/                -> TokenRefreshView               (name: token_refresh, SimpleJWT's own view)
change-password/              -> ChangePasswordAPIView         (name: change-password)
request-password-reset/       -> PasswordResetRequestAPIView   (name: password-reset-request)
reset-password/confirm/       -> PasswordResetConfirmAPIView   (name: password-reset-confirm)
restore/request/               -> AccountRestoreRequestAPIView  (name: restore-request)
restore/confirm/               -> AccountRestoreConfirmAPIView  (name: restore-confirm)
profile/                       -> ProfileAPIView                (name: profile)
delete-account/                -> DeleteAccountAPIView          (name: delete-account)
```

Included at `api/accounts/` by `tresse/urls.py`. **Watch out for:** the
URL path segments don't always match the frontend's own naming for the
same action — `restore/request/`+`restore/confirm/` (backend) vs.
`requestAccountRestore`/`confirmAccountRestore` (frontend function
names, `api/auth.ts`) is a straightforward match, but
`reset-password/confirm/` (backend path) is reached by
`components/PasswordResetConfirm.tsx` posting to
`/accounts/reset-password/confirm/` directly (not through a
`api/auth.ts`-style wrapper) — there's no single file on either side that
lists every path/name pair the way this table does; the mapping only
exists by each caller matching each view's URL by hand.

### `accounts/views.py`

**What it is:** Every account-facing endpoint's business logic — auth
(`CustomTokenObtainPairView`, `RegisterAPIView`, `ChangePasswordAPIView`),
password reset, account restore (request/confirm), the profile
GET/PUT, and self-service deactivation. Also, unusually for this
codebase, a **second, duplicate** set of throttle class definitions
(`PasswordResetAnonThrottle`, `LoginAnonThrottle`, `RegisterAnonThrottle`,
`RestoreAnonThrottle`, and their `*UserThrottle` counterparts) declared
directly in this file rather than imported from `accounts/throttles.py`
— every view below references *these* classes, not the ones in
`throttles.py` (see that file's own Watch out for).

**Module-level helpers:**
- **`_recaptcha_enabled()`**: `False` whenever `settings.DEBUG` is truthy
  (so local/dev runs never require a captcha regardless of whether a
  secret key is configured), otherwise `True` only if
  `settings.RECAPTCHA_SECRET_KEY` is set. This is the single gate every
  captcha-protected view below checks before calling `_verify_recaptcha`.
- **`_verify_recaptcha(token)`**: short-circuits `True` if captcha isn't
  enabled at all; otherwise posts the token to Google's
  `siteverify` endpoint (`requests.post`, 5s timeout) and returns the
  `success` field, with any exception (timeout, network error, malformed
  JSON) swallowed and treated as a failed verification (`return False`
  inside a bare `except Exception`).
- **`_get_client_ip`**, **`_mask_email`**, **`_from_email`**: logging/
  display helpers — `_mask_email` keeps the first 1–2 characters of the
  local part plus the full domain (`"an***@example.com"` for `"anna"`),
  used only in `logger.info`/`logger.exception` calls, never in a user-
  facing response.
- **`RESTORE_WINDOW_DAYS = getattr(settings, "ACCOUNT_RESTORE_WINDOW_DAYS",
  30)`**: read once at import time (module load), not per-request — a
  runtime change to the setting (e.g. via `override_settings` in a test
  that doesn't also reimport this module) would **not** be picked up;
  `accounts/tests.py`'s restore-window tests instead directly mutate a
  user's `deleted_at` to be older/younger than the window rather than
  trying to override this constant.

**`CustomTokenObtainPairView`**: just `serializer_class =
CustomTokenObtainPairSerializer` plus the login throttles — all the
actual logic lives in the serializer (above).

**`RegisterAPIView`** (`AllowAny`, register throttles): optional captcha
check, then `RegisterSerializer`, then `transaction.on_commit(lambda:
send_account_welcome_email(user.id))` — deferred until the transaction
that created the row actually commits, so the welcome email can never
fire for a registration that gets rolled back. Issues a fresh
`RefreshToken.for_user(user)` pair directly (not by calling the login
serializer), so registration logs the user in immediately without a
second request.

**`ChangePasswordAPIView`** (`IsAuthenticated`): validates via
`ChangePasswordSerializer`, then checks
`request.user.check_password(current_password)` itself (the serializer
has no access to `request.user`) before calling `serializer.save(user=user)`.

**Password reset — `PasswordResetRequestAPIView`/`PasswordResetConfirmAPIView`**
(both `AllowAny`, password-reset throttles): the pair fixed by [[P0-04]]
(in `docs/fixes-2026-09.md`).
- **Request**: optional captcha, `PasswordResetRequestSerializer`, then
  looks the user up by `email__iexact`. **If the user exists but
  `is_active` is `False`, the code sets the local `user` variable back to
  `None`** — the exact same generic response
  (`"If an account with that email exists, a password reset link has
  been sent."`) is returned either way, and no email is sent for the
  deactivated case, so this endpoint can't be used to probe whether a
  given email belongs to a deleted account. Builds the reset link inline
  (`{FRONTEND_URL}/reset-password/{uidb64}/{token}/`, using Django's
  `default_token_generator` — the same token mechanism SimpleJWT does
  **not** use; this is a separate, stateless, time-limited signed token,
  not a JWT) and sends it via a plain `send_mail` call with an inline
  f-string body — **not** through a template (`templates/emails/accounts/
  password_reset.txt` exists on disk but is never rendered by anything,
  per the frontend guide's `Backend — email templates` finding).
- **Confirm**: decodes `uidb64` (any exception → the generic
  `{"detail": "Invalid or expired reset link."}` response), looks the
  user up by the decoded pk, checks the token via
  `default_token_generator.check_token`, and — the [[P0-04]] fix — **if
  `not user.is_active`, refuses with that exact same generic response**,
  before touching the password at all. Only past that gate does it
  `set_password`+save. Before this fix, this view unconditionally set
  `is_active=True; deleted_at=None` on a successful token check, meaning
  "forgot password" alone could reactivate a deactivated account with no
  restore-window check whatsoever — see the [[P0-04]] entry in
  `docs/fixes-2026-09.md` for the full history, including the test that
  used to pin the old behavior as intentional
  (`test_confirm_reset_reactivates_deactivated_account`, since removed).

**Account restore — `AccountRestoreRequestAPIView`/
`AccountRestoreConfirmAPIView`** (both `AllowAny`, restore throttles).
Neither uses a serializer at all — both read `request.data` directly
with manual `str(...).strip()` calls, unlike every other view in this
file.
- **Request**: looks the user up; the generic response
  (`_generic_restore_message()`) covers "no such user," "user is
  already active" (nothing to restore), and "user was deleted more than
  `RESTORE_WINDOW_DAYS` days ago" (logged via
  `logger.info("account_restore_expired ...")` before returning the same
  generic text) — three different reasons for "nothing happens," one
  indistinguishable response, by design (so the endpoint can't be used to
  fingerprint account state). Only if the user is inactive *and* still
  inside the window does it build a restore link and
  `transaction.on_commit` the email.
- **Confirm**: the endpoint [[P1-17]] (in `docs/fixes-2026-09.md`)
  changed. `new_password` is optional here (unlike password reset) —
  restoring without setting a new password is a valid request shape,
  since the account may still have a usable password hash from before
  deactivation... **except it never does**, because `mark_deleted()`
  always calls `set_unusable_password()` (see `models.py` above) — so in
  practice, restoring without `new_password` leaves the account
  `is_active=True` but with **no password anyone can log in with**, and
  the customer would need a separate password-reset request afterward.
  If `new_password` **is** given, it's run through Django's
  `validate_password` (the [[P1-17]] fix — previously only a bare
  `len(new_password) < 8` check) and any failure returns
  `{"new_password": [...]}` with `400`, in the **same shape** as
  `PasswordResetConfirmAPIView`'s equivalent failure. Same `deleted_at`
  window check as the request view. On success: a single
  `transaction.atomic()` block sets `is_active=True`, `deleted_at=None`,
  optionally the new password, and saves — this is the inline duplicate
  of `User.restore()` mentioned in `models.py`'s Watch out for.

**`ProfileAPIView`** (`IsAuthenticated`): `GET` `get_or_create`s a
`UserProfile` and returns a flat nine-key snake_case dict (see
`serializers.py`'s `ProfileSerializer` entry above for the [[P1-04]]
history). `PUT` validates via `ProfileSerializer(partial=True)`, then, in
one `transaction.atomic()` block: conditionally updates `User.first_name`/
`last_name`/`email` (only the keys actually present in the validated
data — `if "first_name" in v:`, not `if v.get("first_name"):`, so an
explicit empty string **does** overwrite an existing value, but an
omitted key never touches the field) with a single `user.save(update_fields=...)`
guarded by `try/except IntegrityError` (a duplicate email → `400`
`"This email is already in use."`), then the same field-by-field pattern
for every `UserProfile` field, then one `profile.save()`. Returns the
same shape `GET` does, nested under `{"message": ..., "profile": {...}}`.

**`DeleteAccountAPIView`** (`IsAuthenticated`): requires an explicit
`{"confirm": true}` body (any falsy value → `400`). Inside one
`transaction.atomic()` block: sets `is_active=False`,
`deleted_at=now()`, `set_unusable_password()` (the same three fields
`mark_deleted()` sets — but, like the restore confirm view, this is
**inlined again** rather than calling `user.mark_deleted()`), clears
every `UserProfile` address field to `""` via a single `.update(...)`
call (not a fetch-mutate-save — so this doesn't touch `updated_at`'s
`auto_now`... **unverified**, since `.update()` does bypass `auto_now`
by default in Django unless the field is explicitly included, which
this call doesn't do), builds a restore URL if the user has an email on
file, and `transaction.on_commit`s the deactivation email (only if
`email` is truthy — a conditional expression inside the lambda, not a
separate `if` before scheduling `on_commit` at all).

**What it talks to:** every serializer in `accounts/serializers.py`
except `CustomTokenObtainPairSerializer` (used by the view class
directly, not called manually), `accounts/models.py` (`UserProfile`;
`User` via `get_user_model()`), `accounts/emails.py` (all three
senders), Django's `default_token_generator`/`urlsafe_base64_encode`/
`urlsafe_base64_decode` (the reset/restore link tokens), SimpleJWT's
`RefreshToken`. Frontend: `api/auth.ts` (`loginUser`, `registerUser`,
`requestAccountRestore`, `confirmAccountRestore`),
`api/account/ChangePassword.ts` (`changePassword` — though
`components/PasswordChange.tsx` itself calls `api.post` directly instead
of that wrapper, per the frontend guide's own finding),
`components/PasswordResetConfirm.tsx`, `view/Dashboard.tsx` (profile
GET/PUT, delete-account).

**Watch out for:**
- The duplicate throttle classes (see above) mean a change to, say,
  `password_reset_anon`'s scope name would need to be made in **two**
  files (`accounts/throttles.py` and here) to actually be consistent,
  even though only the copy in this file is load-bearing.
- `AccountRestoreRequestAPIView`/`AccountRestoreConfirmAPIView` are the
  only two views in this app that skip a `Serializer` class entirely —
  every validation/normalization step (`.strip()`, `.lower()`,
  `validate_password`) is written out by hand inline, which is why
  `PasswordResetConfirmSerializer` exists as a *separate, unused-for-restore*
  serializer even though its shape (`uidb64`, `token`, `new_password`,
  `confirm_password`) is nearly identical to what restore-confirm reads
  manually — the restore flow could reuse it (minus `confirm_password`,
  which restore doesn't ask for) but doesn't.
- `DeleteAccountAPIView`'s profile-clearing `.update(...)` call runs
  inside the same transaction as the `User` row's own
  `save(update_fields=[...])` — but uses Django's queryset `.update()`
  rather than the ORM instance methods used everywhere else in this file,
  which is why it doesn't (and can't, without being told to) bump
  `UserProfile.updated_at`.

**Interview questions:**
- *Q: Why does `PasswordResetRequestAPIView` set the local `user`
  variable to `None` for a deactivated account instead of just adding an
  `if user.is_active:` guard around the email-sending block?* — Both
  would produce the same "no email sent" outcome, but setting `user =
  None` makes the rest of the function's `if user:` check do double duty
  — it already has to handle "no such email" the same way, so collapsing
  "deactivated" into the same `None` state means there's exactly one
  branch that decides whether an email goes out, not two separate
  conditions that both have to independently agree not to send.
- *Q: `AccountRestoreConfirmAPIView` allows restoring without a
  `new_password`. What password does the account actually have
  afterward, given `mark_deleted()`'s behavior?* — None it can log in
  with — `mark_deleted()` always calls `set_unusable_password()`, so an
  account restored without supplying a new password comes back
  `is_active=True` but with an unusable password hash; the customer would
  need to go through `PasswordResetRequestAPIView`/`Confirm` afterward
  (which, post-[[P0-04]], now correctly works again once the account is
  active) to actually be able to log in.
- **Harder follow-up:** *Q: Both `PasswordResetConfirmAPIView` and
  `AccountRestoreConfirmAPIView` now run `validate_password` on a new
  password ([[P0-04]] and [[P1-17]] respectively, in
  `docs/fixes-2026-09.md`). Django's `UserAttributeSimilarityValidator` —
  one of the validators in `tresse/settings.py`'s
  `AUTH_PASSWORD_VALIDATORS` — normally compares a new password against
  the user's own email/name to catch something like reusing your email as
  your password. Does either of these two call sites actually get that
  comparison?* — No — both call the module-level `validate_password(value)`
  from `django.contrib.auth.password_validation` with **no `user`
  argument**, which is the same signature `RegisterSerializer` and
  `ChangePasswordSerializer` use too. Without a `user` passed in,
  `UserAttributeSimilarityValidator` has nothing to compare against and
  effectively no-ops for that check specifically (the other validators —
  minimum length, common-password list, all-numeric — still run
  normally, since none of them need the user object). This is consistent
  across every password-setting code path in this app, not a gap unique
  to restore/reset, but it means "don't let a customer set their own
  email address as their password" is not actually enforced anywhere in
  this codebase today.

### `accounts/tests.py`

730 lines, no factory library — every test builds users directly via a
local `_make_user(email, **kwargs)` helper (defaults: phone
`"1234567890"`, password `"testpass123"`, name `"Test User"`) and a
`_make_token_link(user)` helper that mirrors exactly how
`default_token_generator`+`urlsafe_base64_encode` build a real reset/
restore link, so tests can construct a valid `(uidb64, token)` pair
without going through an actual email send. `cache.clear()` runs in every
API test case's `setUp()` — necessary because the throttle classes here
key their rate-limit buckets in Django's cache backend, and a leftover
bucket from an earlier test in the same run would otherwise cause an
unrelated later test to fail with a `429` it isn't expecting.

**What's mocked, by area:**
- `_verify_recaptcha` is patched to `return_value=True` in every test
  that exercises a captcha-gated endpoint (register, password-reset
  request, restore request) — none of them actually reach Google's
  `siteverify` endpoint; the `_recaptcha_enabled()` gate itself (`DEBUG`
  or no secret key configured → disabled) would already skip the real
  call in the test settings anyway, so these patches are mostly
  belt-and-suspenders / self-documenting rather than strictly load-bearing
  (**unverified** without checking `tresse/settings_test.py`'s
  `RECAPTCHA_SECRET_KEY`/`DEBUG` values directly in this pass).
- `send_mail`, `send_account_deleted_email`, `send_account_restore_email`,
  `send_account_welcome_email` are each mocked at their respective test's
  call site — no test in this file lets a real email attempt reach
  Django's configured `EMAIL_BACKEND`.
- The two email-template render tests
  (`AccountEmailTemplatesRenderTestCase`) are the one exception — they
  call `render_to_string` for real, against `welcome.txt` and
  `account_deactivated.txt` specifically (not `account_restore.txt`,
  which is why that template's broken filename, documented in the
  frontend guide's email-templates section, is invisible to this suite).

**What's asserted, by area — organized around what each group of tests
exists to pin down, not a line-by-line list:**
- **`UserManagerTestCase`**: the three required-field `ValueError`s,
  email normalization, password hashing, superuser flag defaults.
- **`UserSoftDeleteTestCase`**: `mark_deleted()`/`restore()` at the model
  layer directly — `is_active`/`deleted_at`/password-usability
  transitions in both directions, independent of any HTTP view.
- **Serializer unit tests** (`RegisterSerializerTestCase`,
  `ChangePasswordSerializerTestCase`): duplicate-email rejection, weak-
  password rejection, password mismatch — exercised by constructing the
  serializer directly with no `APIClient` involved at all.
- **`RegisterAPITestCase`/`LoginAPITestCase`/`ChangePasswordAPITestCase`**:
  the ordinary success/failure paths through the real endpoints, plus one
  test each for the two cross-cutting concerns that matter most here —
  a deactivated account can't log in
  (`test_login_deactivated_account_rejected`), and a recaptcha failure
  blocks registration before a user row is created.
- **`PasswordResetFlowTestCase`**: this is where the [[P0-04]] fix is
  pinned directly — `test_request_reset_for_deactivated_account_sends_no_email`
  and `test_confirm_reset_for_deactivated_account_is_refused` (the latter
  also asserts the account's password hash is **byte-for-byte unchanged**
  after the refused attempt, not just that the response was a `400`) sit
  right alongside the ordinary-flow tests they were added next to,
  replacing the single test
  (`test_confirm_reset_reactivates_deactivated_account`) that used to
  assert the *old*, vulnerable behavior as correct.
- **`AccountDeleteAndRestoreFlowTestCase`**: the largest single test
  class in this file. Covers deactivation clearing the profile; restore-
  request sending an email only for a deactivated account inside the
  window and staying silent for an active account or one past
  `RESTORE_WINDOW_DAYS` (mutating `deleted_at` directly to simulate the
  expired case, rather than mocking `timezone.now()`); restore-confirm
  reactivating on a valid token and being refused past the window; and
  — the [[P1-17]] regression tests — a common password (`"password123"`)
  and an all-numeric one (`"48151623"`) each rejected with Django's
  specific validator message surfaced in `resp.data["new_password"]`,
  alongside one test confirming a genuinely strong password
  (`"Zx9-plum-Harbor-42"`) still restores the account successfully.
- **`ProfileAPITestCase`**: `GET` auto-creating a profile; a `PUT` using
  the **exact payload shape** `Dashboard.tsx`'s `mapFormToApi` sends
  (comment in the test says so directly) round-tripping through a `GET`
  afterward to confirm every field persisted; `PUT` without `email`
  (mirroring `mapFormToApi` omitting the key when the field is blank)
  leaving the existing email untouched rather than clearing it; a
  duplicate-email `PUT` returning `400`.

**Interview question:** *Q: `test_confirm_reset_for_deactivated_account_is_refused`
asserts the user's password hash is unchanged, not just that the HTTP
response was a `400`. Why does that extra assertion matter, given the
view already returns an error status?* — A `400` response alone doesn't
prove nothing was written to the database — a bug could return the right
status code while still calling `set_password`/`save` before the check
that should have blocked it (e.g. if the `is_active` check were
accidentally placed after the password-setting code instead of before
it); asserting the stored hash is byte-for-byte identical to what it was
before the request is the only way to actually prove the refusal
happened **before** any mutation, not just that the final response
happened to look like a rejection.

---

## Backend — products

The largest app in this backend: the product catalog, sizes/stock,
images, the cart, the wishlist, back-in-stock subscriptions, and the
email-send log. Several frontend files call directly into it
(`api/products.ts`, `store/serverCartSlice.ts`, `store/wishListSlice.ts`,
`view/ProductCatalog.tsx`, `view/ProductDetails.tsx`, `view/WishList.tsx`,
`view/Dashboard.tsx`'s admin-adjacent reorder is not exposed there but
`ProductAdmin`'s drag-reorder is) — this section cross-references each by
path, at the same evidence bar as the rest of this guide.

### `products/models.py`

**What it is:** eleven models: `Category`, `Collection`, `ProductGroup`,
`Product`, `Size`, `ProductSize`, `ProductImage`, `ProductWishlist`,
`StockSubscription`, `EmailLog`, `Cart`, `CartItem`, `Review`.

**How it works, by model:**
- **`Category`**/**`Collection`**: near-identical shape (`name`,
  unique `slug`) — two separate taxonomies a product can belong to:
  exactly one `Category` (FK, `on_delete=SET_NULL`) and any number of
  `Collection`s (`ManyToManyField`). `ProductFilter`'s `category` alias
  map (`women`/`men`/`kids` → `woman`/`man`/`kids`, see `filters.py`
  below) is the only place category slugs are normalized against a fixed
  vocabulary; nothing at the model layer constrains what a `Category`'s
  `slug` actually is.
- **`ProductGroup`**: the mechanism behind "this product comes in five
  colors" — a `Product` optionally belongs to one `ProductGroup`
  (`on_delete=SET_NULL`), and every other `Product` in the same group is
  treated as a **color variant** of it (see `ProductColorVariantSerializer`,
  below). A product with no group is its own, single-member group in
  effect (`ProductSerializer.get_variants` falls back to
  `Product.objects.filter(id=obj.id)` when `group_id` is unset).
- **`Product`**: the central model. `ReturnPolicy` (a `TextChoices`:
  `standard`/`final_sale`/`non_returnable_hygiene`) is **snapshotted onto
  every `OrderItem`** at checkout time (`orders/views_stripe.py`, outside
  this app) — this field is the live, editable source of truth; the
  snapshot on a past order is frozen at whatever it was when that order
  was placed, so changing a product's return policy today never
  retroactively changes an existing order's return eligibility. Two
  separate, **overlapping** stock-related booleans exist at the product
  level: `available` (hand-set, "should this product be shown/sellable
  at all") and `in_stock` (also hand-set, on the model) — but the
  serializers and filters never read `Product.in_stock` directly; they
  compute their own `in_stock` from `ProductSize.quantity` instead (see
  `ProductFilter.filter_in_stock` and `ProductSerializer.get_in_stock`,
  both below) — `Product.in_stock` the field looks unused by any read
  path, only ever written (see Watch out for). `allows_custom_sizing` is
  a plain boolean with **no corresponding size/measurement data on the
  model at all** — the actual custom-size mechanism is a `Size` row
  literally named `"CUSTOM SIZE"` (string-matched, not modeled as a
  distinct type — see `ProductFilter`'s custom-size handling references
  elsewhere in this codebase, and `CartItemSerializer`'s custom-length
  logic below for the *sibling* mechanism this field doesn't gate).
  `allows_custom_length`/`custom_length_cm`/`custom_length_surcharge` are
  the fields that actually matter for `CartItemSerializer`'s
  server-side snapshot (below) — `custom_length_cm` defaults to `10`,
  `custom_length_surcharge` defaults to `35` (a flat dollar amount, not a
  percentage). `Meta.ordering = ("sort_order", "-created_at", "id")` —
  the same three-key ordering `ProductViewSet` explicitly repeats as its
  own `ordering` list (redundant, but consistent).
- **`Size`**: just a unique `name` — no fixed enum; `"CUSTOM SIZE"`,
  `"ONE SIZE"`, and every numeric/lettered size are all plain rows in
  this same table, distinguished only by string comparison wherever code
  needs to special-case one (`_normalize_size_label`/`CUSTOM_SIZE_LABEL`
  in `orders/views_stripe.py`, `products/filters.py`'s category handling
  is unrelated but the same "string-matched special value" pattern
  recurs across this codebase).
- **`ProductSize`**: the `(product, size)` join row that actually carries
  `quantity` — this is the real stock ledger; `Product.in_stock` and
  `Product.available` are coarser, separate flags that don't derive from
  it automatically. **Carries the zero-to-positive restock detection
  mechanism directly on the instance**: `__init__` stashes
  `self.__original_quantity = self.quantity` (name-mangled to
  `_ProductSize__original_quantity` by Python, since the double-underscore
  prefix is written inside this class's own body) for a freshly
  **constructed** (not loaded) instance, and the classmethod override
  `from_db` does the same for an instance **loaded** from the database —
  the two code paths exist because `__init__` alone would only see the
  value passed to a plain `ProductSize(...)` constructor call, not what
  was actually in a row fetched from the database and about to be
  mutated+saved; `from_db` is Django's documented hook for exactly this
  "I need to know a field's value as it was read from the DB, before any
  in-memory changes" use case. `products/signals.py`'s `post_save`
  handler is the only code that reads this mangled attribute (see below)
  — `unique_together = ("product", "size")`.
- **`ProductImage`**: `image` (required `ImageField`, unlike
  `Product.color_swatch_image`/`main_image`, which are both nullable) +
  `alt_text`, `is_primary`, `sort_order`. `Meta.ordering = ("sort_order",
  "id")` — the same ordering `get_product_main_image_url`
  (`serializers.py`) explicitly re-applies with its own `.order_by(...)`
  call rather than relying on this default (defensive, since `.first()`
  on an already-default-ordered queryset would behave the same either
  way — belt-and-suspenders, not a bug). Has its own `image_url` Python
  `@property` (`try: return self.image.url; except Exception: return ""`)
  — this is a **third, independent** copy of the "guard `.url` access"
  pattern also implemented in `serializers.py`'s
  `get_product_main_image_url` and (as of the "Catalog 500 on unguarded
  image URLs" fix, `docs/fixes-2026-09.md`) `ProductImageSerializer.get_image_url`
  — **this model property itself is never actually called from
  anywhere in `serializers.py` or `views.py`** (confirmed by grep — the
  serializer defines and uses its own `get_image_url` method instead,
  duplicating rather than delegating to this property); it's read only
  by `products/admin.py`'s `ProductImageInline.preview` (a **different**,
  fourth guard, written independently rather than calling this property
  either — see `admin.py` below).
- **`ProductWishlist`**/**`StockSubscription`**: both simple join-style
  models (`user`+`product`, and `product`+optional `user`+`email`
  respectively) with `unique_together` preventing a duplicate row —
  this is what makes `get_or_create` in both `WishlistViewSet`/
  `ProductViewSet.wishlist` and `subscribe_back_in_stock` (`views.py`,
  below) a true idempotent operation rather than one that merely happens
  not to duplicate in practice. `StockSubscription.notified_at` is the
  field `products/signals.py` sets once an email actually goes out —
  it's what makes a subscriber only ever notified once per restock cycle,
  not once per size/purchase event.
- **`EmailLog`**: a generic outbox record (`email_type` choices include
  `back_in_stock`/`cart_reminder`/`wishlist_reminder`/`password_reset`/
  `order_confirmation`/`other`) written by `products/emails.py`'s
  `send_email_with_log` — but **only the three sends that actually go
  through that helper** (back-in-stock, cart reminder, wishlist reminder,
  all from this same app) ever create a row here; `password_reset` and
  `order_confirmation` are listed as valid `email_type` choices but
  nothing in `accounts/` or `orders/` ever imports or calls
  `send_email_with_log` — those two choices exist in the enum with no
  code path that would ever produce a row using them (**unverified**
  whether this was aspirational/for a future audit trail, or a leftover
  from before those two apps had their own separate send functions).
- **`Cart`**: one-to-one with `User` (`related_name="cart"` — a user can
  have at most one cart, enforced at the DB level by the `OneToOneField`
  itself). **`CartItem`**: the line items — see `serializers.py`'s
  `CartItemSerializer` entry (below) for the field that matters most,
  the custom-length snapshot. `Meta.ordering = ("id",)` — insertion
  order, not e.g. by product name.
- **`Review`**: `unique_together = ("product", "user")` — one review per
  user per product — but **nothing anywhere in this backend exposes a
  create/list endpoint for this model at all**, confirmed by a
  repo-wide search for `review`/`Review` outside `products/models.py`
  and `products/admin.py` (only `ReviewAdmin` and the model's own
  migration history reference it). `accounts/middleware.py`'s whitelist
  even name-checks `/api/reviews` as an always-allowed anonymous path
  (see that file's own entry above), but no app in this project defines
  a URL under that path — it's genuinely unreachable scaffolding, a
  feature whose model and admin were built but whose API was either
  never written or was removed without touching the model, admin, or
  middleware whitelist that still reference it.

**What it talks to:** `settings.AUTH_USER_MODEL` (`accounts.User`, via
`Cart`/`ProductWishlist`/`StockSubscription`/`Review`). Read throughout
`products/serializers.py`, `views.py`, `admin.py`, `signals.py`, and by
`orders/models.py`/`orders/views_stripe.py` (which reads `Product`/
`ProductSize`/`CartItem` directly when building an order from a paid
checkout — outside the scope of this section).

**Watch out for:**
- **`Product.in_stock` and `Product.available` are both hand-set fields
  that nothing derives automatically, and `in_stock` specifically looks
  write-only from every read path this section found.** An admin could
  toggle `Product.in_stock` to `True` for a product with zero `ProductSize`
  quantity anywhere, and every customer-facing view
  (`ProductFilter.filter_in_stock`, `ProductSerializer.get_in_stock`)
  would still correctly compute "out of stock" from the real
  `ProductSize` rows and ignore the flag entirely — the field isn't
  wrong, it's just not load-bearing for anything a customer sees.
- **Four independent implementations of "guard a possibly-raising
  `.url` access"** exist across this codebase for image fields:
  `ProductImage.image_url` (this file, a model `@property`, unused by
  the serializers), `get_product_main_image_url` and
  `ProductImageSerializer.get_image_url`/`ProductSerializer.get_color_swatch_url`/
  `ProductColorVariantSerializer.get_color_swatch_url` (`serializers.py`,
  the ones actually wired to API responses, three of which needed the
  "Catalog 500 on unguarded image URLs" fix), and
  `ProductImageInline.preview`/`ProductAdmin.color_preview`
  (`admin.py`, admin-only). None of the four call each other.
- **`ProductSize.__original_quantity`'s name-mangling is a real trap for
  a naive reader or a future refactor.** Writing `instance._ProductSize__original_quantity`
  in `signals.py` (a different module) only works because Python's name
  mangling is purely lexical (based on which class body the
  double-underscore identifier is written inside, not on any runtime
  access-control) — `signals.py`'s own comment says this explicitly, but
  renaming the private attribute in `models.py` without updating
  `signals.py`'s hardcoded mangled string would silently break restock
  detection with no error at all (the `getattr(instance,
  "_ProductSize__original_quantity", None)` call would just always
  return the default `None`, which `notify_when_back_in_stock` treats
  the same as "no prior value to compare, not a genuine restock" — so
  the failure mode is **silent under-notification**, not a crash).

**Interview questions:**
- *Q: Why does `ProductSize` need both an `__init__` override and a
  `from_db` classmethod override to track its original quantity, instead
  of just one or the other?* — `__init__` runs for every instance
  construction, including a fresh `ProductSize(...)` call that was never
  loaded from the database (e.g. inside `ProductSizeInline`'s "add new"
  form) — for that case there's no "original" DB value to speak of, so
  the current `self.quantity` at construction time is the closest
  approximation. `from_db` is Django's hook specifically for "this
  instance was just materialized from a database row" — it has access
  to the actual field values as stored, which is what the signal handler
  needs to compare against after an in-memory mutation and `.save()`.
  Without `from_db`, `Product.objects.get(...)` followed by
  `instance.quantity = 5; instance.save()` would have no reliable record
  of what the quantity was *before* that assignment.
- *Q: `Product.ReturnPolicy` is snapshotted onto `OrderItem` at checkout.
  Walk through what happens if a product's return policy is changed from
  `standard` to `final_sale` the day after a customer's order shipped.*
  — Nothing changes for that existing order — `orders/views_stripe.py`
  copies `product.return_policy` onto the `OrderItem` row at the moment
  the order is created from a paid checkout session, and every
  return-eligibility check downstream (`orders/views.py`'s
  `RequestReturnAPIView`, `orders/admin.py`'s `approve_return`) reads
  that frozen `OrderItem.return_policy`, never `Product.return_policy`
  live — a policy change only affects orders placed **after** the
  change.
- **Harder follow-up:** *Q: Two concurrent requests both call
  `ProductSize.objects.get(pk=X)`, both see `quantity=0`, and both then
  set `quantity=5` and save — is there a race where the restock
  notification could fire twice, once per request?* — Both `from_db`
  calls independently capture `previous_quantity=0` for their own
  in-memory instance, so **yes**, both saves would independently satisfy
  `previous_quantity == 0 and instance.quantity > 0` and each would
  trigger `notify_when_back_in_stock`'s `transaction.on_commit` — the
  signal handler itself has no locking. In practice, `StockSubscription.notified_at`
  provides the actual guard against a subscriber being emailed twice:
  each of the two signal invocations queries
  `StockSubscription.objects.filter(product=product, notified_at__isnull=True)`
  independently and (barring a second race on the `notified_at` write
  itself, which isn't `select_for_update`-guarded here either) the first
  one to actually execute its `sub.save(update_fields=["notified_at"])`
  wins; the second invocation's own loop would still have queried the
  subscription list **before** the first one wrote `notified_at`
  (both queries can run before either save, since neither is locked), so
  a genuine double-send is possible under real concurrency — this
  specific race is **unverified** against a real concurrent test in
  `products/tests.py`'s `StockSignalTestCase`, which only tests
  sequential saves.

### `products/migrations/`

Twenty-three migrations. The broad strokes: `0001_initial` creates the
core catalog shape; `0002`–`0004` are pure data migrations
(`RunPython`) seeding `Size` rows, an initial product catalog, and a
`"ONE SIZE"` row — none of them touch schema. `0005`/`0015` add and
later re-add `Product.main_image` (it was briefly removed by `0014` and
brought back by `0015` — a genuine back-and-forth, not a typo in this
summary). `0006`/`0007` add and backfill `Category.slug`. `0008`/`0009`
add two indexes and then remove them again one migration later. `0010`
creates `ProductWishlist`/`StockSubscription`. `0012` adds `Collection`
and the `color_swatch_image`/`color_name`/`color_hex` fields (later
folded into `0016`'s fuller color-variant/`ProductGroup` shape — the
model as it reads today). `0013`/`0014` are large `AlterModelOptions`/
`AlterUniqueTogether` sweeps (ordering and constraint cleanup across
several models at once) — `0014` also removes `main_image` (see above)
and adds `care_instructions`/`Product.in_stock`/
`StockSubscription.notified_at`. `0017` adds `EmailLog`. `0018`/`0023`
add the seven `CartItem` custom-measurement fields and, separately, the
custom-length fields — in two different migrations despite both being
"custom X" fields on the same model, because `allows_custom_length`
shipped later than the bust/waist/hips measurement fields did. **`0019`
is worth calling out on its own**: it drops `CartItem`'s
`unique_together` (added one migration earlier, in `0018`) back to no
constraint at all — this is *why* `CartItemSerializer._get_other_cart_quantity`
(below) has to sum quantity across **multiple** `CartItem` rows for the
same `(cart, product_size)` pair rather than being able to assume at
most one row exists; without `0019`, that summing logic would be dead
code guarding against a case the database itself wouldn't allow. `0020`–
`0022` add `sort_order`, tighten `Product`'s default ordering, and add
`return_policy`.

### `products/apps.py` and `products/signals.py`

**What they are, together:** the entire back-in-stock notification
mechanism — `apps.py`'s `ProductsConfig.ready()` is the **only** place
`signals.py` is ever imported (`from . import signals  # noqa: F401`,
inside `ready()`), which is what actually connects the `@receiver`
decorator in `signals.py` to Django's signal dispatcher; without this
import, the `@receiver(post_save, sender=ProductSize)` decoration in
`signals.py` would simply never execute and the whole mechanism would be
silently inert — this was, in fact, exactly the [[P0-01]] bug (in
`docs/fixes-2026-09.md`): the signal handler function existed and was
correctly written, but nothing ever imported the module that defined it,
so no restock email was ever sent, for any product, ever, until this
`ready()` hook was added.

**How `notify_when_back_in_stock` works, step by step:**
1. Reads `instance._ProductSize__original_quantity` (the mangled
   attribute `models.py`'s `__init__`/`from_db` set — see that file's
   own Watch out for on the name-mangling itself) as `previous_quantity`,
   defaulting to `None` if it's somehow absent.
2. **Immediately overwrites it** with the just-saved `instance.quantity`
   — so if this same in-memory `instance` were saved again later in the
   same request/process without being re-fetched from the DB, the *next*
   `post_save` firing would compare against *this* save's value, not the
   original one from before either save. This is what makes the "genuine
   zero-to-positive restock, not a purchase decrement, not an admin edit
   that doesn't cross zero" distinction actually hold across multiple
   saves of the same instance, not just the first one.
3. `if instance.quantity <= 0: return` — no notification for a save that
   leaves stock at zero or negative (the field is a
   `PositiveIntegerField`, so negative shouldn't be reachable in
   practice, but the check doesn't assume that).
4. `if previous_quantity is None or previous_quantity > 0: return` —
   this is the [[P0-02]] guard (in `docs/fixes-2026-09.md`): before it
   existed, **every** save that left quantity positive would notify,
   including a product going from `quantity=3` to `quantity=5` (an
   ordinary restock top-up with no subscriber-relevant "it was
   unavailable and now isn't" transition) or even a purchase that
   decremented from `5` to `4` (which, before the fix, could apparently
   still satisfy whatever the original condition was — the fixes
   documentation is the authoritative source for the exact shape of the
   pre-fix bug; this section states the **current** condition as read
   from the code). `previous_quantity is None` also matters for a
   freshly **created** row (via `admin`'s inline formset, or a script) —
   there's no "previous" value at all for a `ProductSize` that's being
   inserted for the first time with, say, `quantity=5`; that case is
   explicitly treated as *not* a restock (no subscriber could have
   subscribed to a size that didn't exist yet).
5. Queries `StockSubscription.objects.filter(product=product,
   notified_at__isnull=True)` — every subscriber for the **product**
   (not the specific `ProductSize`/size that restocked — a subscription
   is per-product, not per-size, so a customer who subscribed while, say,
   a Medium was out of stock gets notified when a Small restocks too,
   even if Medium is still at zero).
6. `if not subscriptions.exists(): return` — a query just to short-
   circuit before building the product URL and the `transaction.on_commit`
   closure, avoiding that setup work for the (presumably common) case of
   a restock with no waiting subscribers.
7. Builds `product_url` once, outside the closure, then defines
   `_send_after_commit()` — a per-subscription loop, each iteration
   wrapped in its own `try/except Exception: logger.exception(...)`, so
   one subscriber's email failing (a bad address, a transient SMTP error)
   doesn't stop the rest of the list from being processed. Each success
   sets `sub.notified_at = timezone.now()` and saves **immediately**,
   inside the loop, not batched at the end — so a failure partway through
   a long subscriber list leaves the already-succeeded ones correctly
   marked and only the remainder eligible for a future retry (there is no
   retry mechanism in this codebase; "eligible for a future retry" means
   "the next time this exact product crosses zero-to-positive again,"
   not an automatic re-attempt).
8. The entire closure is scheduled via `transaction.on_commit`, not run
   inline — so if the save that triggered this signal is itself rolled
   back (part of a larger failed transaction elsewhere), no email is
   ever sent for a stock change that never actually persisted.

**What it talks to:** `products/emails.py` (`send_back_in_stock_email`),
`products/models.py` (`ProductSize`, `StockSubscription`). Frontend:
nothing calls this directly — it's entirely server-triggered, by any
code path that saves a `ProductSize` with a higher quantity (an admin
edit via `ProductSizeInline`, or — outside this app —
`orders/views_stripe.py`'s Stripe webhook decrementing stock on a
purchase, which is a decrease, never itself the trigger).

**Watch out for:** per the "Harder follow-up" interview question in
`models.py`'s section above, this handler has **no explicit locking**
around either the restock-detection comparison or the
`notified_at`-write race between concurrent saves of the same
`ProductSize` — in practice, a genuine simultaneous double-save of the
exact same size row is a narrow window (an admin manually editing stock
concurrently with... itself, or with a purchase's own decrement landing
at the same instant on the same row, which is a decrease and wouldn't
trigger this path anyway), so the theoretical double-notification risk
is real but not the most likely failure mode this mechanism has already
had (that was [[P0-01]]/[[P0-02]], both about the handler never firing
or firing too eagerly, not about firing twice).

**Interview questions:**
- *Q: Why is the subscriber loop's `try/except` **inside** the loop, per
  subscription, rather than one `try/except` around the whole
  `_send_after_commit` function?* — So one bad email address or one
  transient send failure doesn't abort the entire batch — with the
  `try/except` per-iteration, a list of ten subscribers where the third
  one fails still successfully notifies (and marks `notified_at` for) the
  other nine; a single outer `try/except` would stop at the first failure
  and leave subscribers four through ten un-notified even though nothing
  was actually wrong with their own addresses.
- *Q: What would happen if `apps.py`'s `ready()` method were deleted
  entirely, with `signals.py` left completely unchanged?* — Exactly the
  [[P0-01]] bug: `signals.py`'s `@receiver` decorator only takes effect
  when the module containing it is imported somewhere Django actually
  executes — with no import anywhere, the decorator line never runs, no
  signal gets connected, `ProductSize.save()` calls proceed completely
  normally with no side effect, and no back-in-stock email is ever sent
  for any product, with no error, warning, or any other visible symptom
  — the code all looks correct in isolation, which is exactly why this
  class of bug is easy to miss without a test that actually exercises
  `.save()` through the real Django app registry (which
  `StockSignalTestCase`, using `TestCase` and the real app config, does).
- **Harder follow-up:** *Q: `StockSignalTestCase`'s tests all wrap the
  triggering `.save()` in `self.captureOnCommitCallbacks(execute=True)`.
  What would each of those tests actually observe if that wrapper were
  removed?* — `transaction.on_commit` callbacks are deferred until the
  enclosing transaction actually commits — Django's `TestCase` wraps
  every test method in a transaction that's rolled back at the end (for
  isolation between tests), so absent `captureOnCommitCallbacks`,
  `_send_after_commit` would **never run** during the test at all (the
  "commit" it's waiting for never happens inside a `TestCase`), and every
  assertion checking `mock_send.assert_called_once()`/
  `notified_at is not None` would fail — not because the signal logic is
  wrong, but because the test harness's own transactional isolation
  would silently prevent the deferred callback from ever firing.

### `products/throttles.py`

`StockSubscribeAnonThrottle`/`StockSubscribeUserThrottle` — two classes,
`scope = "stock_subscribe_anon"`/`"stock_subscribe_user"`. Used only by
`ProductViewSet.subscribe_back_in_stock` (`views.py`, below). Unlike
`accounts/throttles.py`, there's no duplicate copy of these classes
anywhere else in this app.

### `products/filters.py`

**What it is:** `ProductFilter(django_filters.FilterSet)` — the
`filterset_class` both `ProductViewSet` and `WishlistViewSet` use.

**How it works:** `category` (a `CharFilter` with a custom `method`, not
a direct field match) accepts a slug **or** one of a fixed alias map
(`women`/`womens`/`woman` → `woman`; `men`/`mens`/`man` → `man`;
`kid`/`kids` → `kids`), lowercased and stripped before lookup —
case-insensitive (`iexact`) against `Category.slug`. `available`
(`BooleanFilter`, direct field). `in_stock` (a `BooleanFilter` with a
custom `method`): builds an `Exists(ProductSize.objects.filter(product_id=OuterRef("pk"),
quantity__gt=0))` subquery and filters on it — this is the query-layer
twin of `ProductSerializer.get_in_stock`'s Python-level
`obj.sizes.filter(quantity__gt=0).exists()` fallback (below); both
compute the exact same thing, once as a filter and once as a serialized
field, independently. `min_price`/`max_price` (`gte`/`lte` on `price`).
`collection` (`iexact` on `collections__slug`).

**What it talks to:** `products/models.py` (`Product`, `ProductSize`).
Used by `products/views.py`'s `ProductViewSet`/`WishlistViewSet`
(`filterset_class = ProductFilter`). Frontend: `api/products.ts`'s
`fetchProducts` passes `category`/`collection`/`in_stock`/`min_price`/
`max_price` straight through as query params.

**Watch out for:** the frontend guide's own `api/products.ts` entry
flags a related concern from that side — `products/views.py`'s
`ProductViewSet.get_queryset` **also** filters `category`/`collection`
by hand (`if category_slug: queryset = queryset.filter(category__slug=category_slug)`),
in addition to this `FilterFilter`'s own handling, and **only this
class's `filter_category` method knows the alias map** — the manual
filter in `get_queryset` does an exact `category__slug=category_slug`
match with no aliasing at all. Both filters run (DRF applies every
configured filter backend), so a request with `?category=woman` (the
canonical slug) is filtered identically twice — redundant but harmless —
while `?category=women` (an alias) is filtered correctly by
`ProductFilter` but then **also** filtered again by `get_queryset`'s
literal `category__slug="women"` match, which would find nothing, since
no `Category` row actually has the slug `"women"`. Confirmed directly in
this pass: `get_queryset`'s manual filtering runs on the same queryset
`ProductFilter` will filter afterward via `filter_backends`/
`filterset_class`, and Django QuerySet filters are additive (`AND`ed)
— so `?category=women` should currently return **zero products**, since
the manual `category__slug="women"` clause alone (with no matching
category) empties the queryset before `ProductFilter` even gets a
chance to apply its own, correct aliasing.

**Interview question:** *Q: Given the manual filtering in
`get_queryset` and `ProductFilter`'s own `filterset_class` wiring both
apply to the same request, why doesn't `?category=woman` (the actual
slug, not an alias) break the same way `?category=women` does?* — Because
`get_queryset`'s manual clause uses the literal query param value
directly (`category__slug=category_slug`) — for the canonical slug
itself, that manual filter and `ProductFilter`'s aliased filter (which
maps `"woman"` to itself, a no-op through the alias table) both resolve
to the identical `category__slug="woman"` condition, so `AND`ing two
identical filters together is redundant but not destructive; it's only
an **alias** value where the manual filter's un-aliased literal match
diverges from what `ProductFilter` correctly resolves it to, and the
`AND` of "the right filter" with "a filter for a slug that doesn't
exist" is what empties the result.

### `products/emails.py`

**What it is:** `send_email_with_log` (the shared low-level sender +
`EmailLog` writer), plus three call sites:
`send_back_in_stock_email` (template-rendered, `templates/emails/products/
back_in_stock.txt`), `send_cart_reminder_email`/`send_wishlist_reminder_email`
(both build their body as an inline f-string, **no template file at
all** — the frontend guide's own `Backend — email templates` section
notes this explicitly: these two are the only email sends in the
backend that skip `render_to_string` entirely).

**How `send_email_with_log` works:** builds an `EmailMessage` (not
`EmailMultiAlternatives` — plain text only, like every email in this
backend except `newsletter_welcome`), sends it, and — **inside the same
`try` block as the send itself** — writes an `EmailLog` row reflecting
whether `msg.send(fail_silently=False)` returned a truthy result. If
`send()` raises, the `except` branch writes a **`status="failed"`**
`EmailLog` row with the exception's `str()` as `error_message`, then
**re-raises** — unlike every sender in `accounts/emails.py`/
`orders/emails.py`, which all swallow their own exceptions behind a bare
`except Exception: logger.exception(...)`, this function's callers
(`send_back_in_stock_email`, called from `products/signals.py`'s own
`try/except` — see that file above; `send_cart_reminder_email`/
`send_wishlist_reminder_email`, called from `accounts/admin.py`'s bulk
actions, which have their **own** `try/except` per user) are each
responsible for catching the re-raised exception themselves. This is the
one email-sending module in the backend that doesn't self-contain its
own failure.

**What it talks to:** `products/models.py` (`EmailLog`, `Product`).
Called from `products/signals.py` (back-in-stock) and
`accounts/admin.py`'s two bulk actions (cart/wishlist reminders — see
that file's own entry above).

**Watch out for:** `send_email_with_log` silently returns (no send, no
`EmailLog` row, no exception) if `to_email` is falsy — there's no log
entry at all for "we tried to email someone but had no address," which
means an `EmailLog`-based audit of send attempts can't distinguish
"never attempted because we had no address" from "genuinely never
triggered" — both simply produce zero rows.

### `products/serializers.py`

**What it is:** thirteen serializers spanning the whole catalog + cart
surface: `ProductImageSerializer`, `CategorySerializer`,
`CollectionSerializer`, `ProductGroupSerializer`, `SizeSerializer`,
`ProductSizeInlineSerializer`, `ProductMiniSerializer`,
`ProductColorVariantSerializer`, `ProductSerializer`,
`ProductSizeSerializer`, `CartItemSerializer`, `CartSerializer` — plus
three module-level helper functions (`force_https`, `build_abs_https`,
`get_product_main_image_url`).

**The image-URL helpers, first, since three serializers depend on
them:**
- **`force_https(url)`**: rewrites an `http://` URL's scheme to
  `https://` (via `urlparse`/`urlunparse`); leaves a schemeless value
  (a bare relative path) and anything already `https://` untouched.
- **`build_abs_https(request, url)`**: if `url` starts with `/` and a
  `request` is available, calls `request.build_absolute_uri(url)` first
  (turning a storage-relative path into a full URL against the current
  host), then always runs the result through `force_https`. Without a
  `request` in context (e.g. a serializer instantiated outside a view,
  as some tests do), a relative URL stays relative.
- **`get_product_main_image_url(obj, request)`**: tries the first
  `ProductImage` (by `sort_order`, `id`) if one exists and has a file,
  falling back to `Product.main_image` if not, returning `None` if
  neither yields a URL — **both** branches are individually wrapped in
  their own `try/except Exception: pass` (silent, no logging) rather
  than one `try/except` around the whole function, so a broken first
  image doesn't prevent falling through to try `main_image` as a second
  chance. This function predates, and was the template for, the
  "Catalog 500 on unguarded image URLs" fix (`docs/fixes-2026-09.md`) —
  the three serializer methods that fix touched (`ProductImageSerializer.get_image_url`,
  `ProductSerializer.get_color_swatch_url`,
  `ProductColorVariantSerializer.get_color_swatch_url`) were brought up
  to the same "never let `.url` raise past this function" standard this
  one already met, **except** those three now also call
  `logger.exception(...)` before returning `None`, which this original
  function still does not — a real, if minor, inconsistency: the
  original pattern this fix was modeled on is stricter about silence
  than the fix itself ended up being.

**`ProductImageSerializer`**: `id`, `image_url` (`SerializerMethodField`,
guarded per the fix above), `sort_order`, `alt_text`, `is_primary`. Used
nested inside `ProductSerializer.images` (`many=True`).

**`CategorySerializer`/`CollectionSerializer`/`ProductGroupSerializer`**:
near-identical three-field passthroughs (`id`, `name`, `slug`).

**`SizeSerializer`**: `id`, `name`. **`ProductSizeInlineSerializer`**:
nests `SizeSerializer` (read-only) plus `id`, `quantity` — used inside
`ProductSerializer.sizes`. **`ProductSizeSerializer`** (a different,
top-level serializer, not the inline one above) additionally nests a
full `ProductMiniSerializer` for `product` — used only inside
`CartItemSerializer.product_size` (below), which is why a cart line's
`product_size` payload is much richer than the plain
`ProductSizeInlineSerializer` nested under a product listing.

**`ProductMiniSerializer`**: `id`, `name`, `price`, `return_policy`,
`allows_custom_length`, `custom_length_cm`, `custom_length_surcharge`,
`main_image_url` — a deliberately trimmed `Product` view (no `category`,
`images` list, `variants`, wishlist state, etc.) used specifically where
a cart line needs just enough product context to render and to know
whether custom-length applies, without the full catalog payload's
weight.

**`ProductColorVariantSerializer`**: `id`, `name`, `color_name`,
`color_hex`, `color_swatch_url`, `main_image_url`, `return_policy` — one
entry per color variant, returned as a list by `ProductSerializer.get_variants`
(below). `get_color_swatch_url` is one of the three methods the "Catalog
500" fix touched.

**`ProductSerializer`**: the full catalog payload —
`ProductViewSet`/`WishlistViewSet`'s `serializer_class`. Nests
`ProductImageSerializer` (`images`, many), `ProductSizeInlineSerializer`
(`sizes`, many), `CategorySerializer`, `CollectionSerializer` (many),
`ProductGroupSerializer`, plus six `SerializerMethodField`s:
`color_swatch_url` (also touched by the "Catalog 500" fix),
`main_image_url`, `variants`, `collections_slugs`, `collections_names`,
`is_in_wishlist`, `in_stock`.
- **`get_variants`**: if `obj.group_id` is set, returns every
  `available=True` product in the same group (ordered by `id`),
  serialized via `ProductColorVariantSerializer(..., context=self.context)`
  — **including `obj` itself**, since the queryset is `obj.group.products.filter(available=True)`
  with no exclusion of the current product's own id. Without a group,
  falls back to `Product.objects.filter(id=obj.id)` — a one-item
  queryset containing just this product, so `variants` is **never
  empty** for any product this serializer runs against, grouped or not.
- **`get_is_in_wishlist`**: prefers an **annotation** (`obj._is_in_wishlist`,
  set by `ProductViewSet.get_queryset`/`WishlistViewSet.get_queryset`
  via `Exists(...)` — see `views.py` below) if present, falling back to
  a **per-object query** (`ProductWishlist.objects.filter(user=user,
  product=obj).exists()`) only if the annotation is absent. This
  fallback path exists specifically for `get_variants`' nested
  `ProductColorVariantSerializer` calls and for any other code path that
  constructs `ProductSerializer` against an unannotated queryset — but
  `ProductColorVariantSerializer` itself has **no** `is_in_wishlist`
  field at all (it's not in that serializer's `Meta.fields`), so this
  fallback is dead weight specifically for the variants path; it matters
  for the top-level product list/detail responses, where
  `get_queryset`'s annotation is what actually avoids an N+1 query per
  product on a paginated list of 12+ items.
- **`get_in_stock`**: same annotation-first, query-fallback pattern
  (`obj._in_stock`), the Python-level twin of `ProductFilter.filter_in_stock`'s
  SQL-level `Exists(...)` subquery — both independently compute "does
  this product have any `ProductSize` with `quantity > 0`."

**`CartSerializer`**: `id`, `user` (read-only), `created_at`, `items`
(`CartItemSerializer`, many, read-only) — thin; all the real logic is in
the item serializer, below.

**`CartItemSerializer` — the file's most consequential serializer, and
the one the task singled out:**
- **Fields:** `product_size` (nested `ProductSizeSerializer`, read-only —
  what a `GET`/response shows) vs. `product_size_id`
  (`PrimaryKeyRelatedField`, `source="product_size"`, `write_only=True`,
  `required=False` — what a `POST`/`PUT` body sends); `quantity`
  (`min_value=1` via `extra_kwargs`, `required=False` so a `PUT` can omit
  it); the seven measurement fields (`custom_bust` etc., plain
  passthrough, client-writable); and — the field the task calls out
  specifically — **`custom_length_cm` and `custom_length_surcharge`,
  both explicitly declared `read_only=True`** on the serializer, overriding
  whatever DRF's automatic `ModelSerializer` field generation would have
  inferred from the model (which would otherwise make them ordinary
  writable fields, since neither is `editable=False` on the model
  itself). A client can send these two keys in a request body; DRF's
  serializer will simply **discard** them during validation, since a
  `read_only` field's incoming value is never placed into
  `validated_data` at all.
- **`_get_cart`/`_get_product_size`/`_get_requested_quantity`**: small
  helpers that each fall back to `self.instance`'s existing value when
  the corresponding key isn't present in `attrs` — this is what makes
  the same `validate()` method correctly handle both a `create`
  (`self.instance is None`, everything must come from `attrs`) and a
  **partial** `update` (`self.instance` exists; a `PUT` with just
  `{"quantity": 4}` still needs to validate against the *existing*
  `product_size`, not a missing one). `_get_requested_quantity` also
  does its own `int(...)` coercion with a `try/except (TypeError,
  ValueError)` → a field-level `ValidationError`, independent of
  whatever DRF's own `IntegerField` coercion would have done — this
  method operates on the raw `attrs` dict inside `validate()`, not
  through a declared `IntegerField`, since `quantity` here is defined
  via `extra_kwargs` on the model field, not overridden as its own
  explicit serializer field the way `custom_length_cm` is.
- **`_get_other_cart_quantity`**: sums `quantity` across every other
  `CartItem` in the same cart for the **same** `product_size`
  (excluding `self.instance` on an update, so editing an existing line
  doesn't count itself twice) — this is the method that only makes sense
  given migration `0019` dropping `CartItem`'s `unique_together`
  constraint (see the migrations section above): without that migration
  history, at most one `CartItem` row could ever exist per
  `(cart, product_size)` pair, and this summing loop would have at most
  one row to sum regardless.
- **`validate()`**: the full eligibility chain, in order — product must
  be `available`; the size's `ProductSize.quantity` must be `> 0` at
  all (a distinct check from the next one, giving a specific "out of
  stock" message rather than folding it into the quantity-exceeded
  message); `other_cart_quantity + quantity` (this line's requested
  total, plus every *other* line already in the cart for the same size)
  must not exceed `available_quantity` — the message pluralizes correctly
  (`"1 item"` vs. `"N items"`); and, only if `custom_length_selected` is
  truthy (falling back to the existing instance value on update), the
  product must have `allows_custom_length=True` or the request is
  rejected.
- **`_apply_custom_length_snapshot(validated_data)`**: called from both
  `create()` and `update()`, **after** `validate()` has already run (so
  the `allows_custom_length` gate has already been enforced once). If
  `custom_length_selected` (from `validated_data`, falling back to the
  existing instance) is truthy: re-fetches `product.allows_custom_length`
  and **raises again** if it's somehow `False` here (a second,
  redundant check — see Watch out for), then sets
  `validated_data["custom_length_cm"] = product.custom_length_cm` and
  `validated_data["custom_length_surcharge"] = product.custom_length_surcharge`
  — **copied directly from the `Product` row at the moment of save, not
  from anything the client sent** (the client couldn't have sent them
  anyway — both fields are `read_only`). If `custom_length_selected` is
  falsy: explicitly resets all three related fields
  (`custom_length_selected=False`, `custom_length_cm=None`,
  `custom_length_surcharge=0`) — so **unchecking** custom length on an
  existing line (via a `PUT`) correctly clears a previously-snapshotted
  surcharge, rather than leaving a stale surcharge in place attached to
  a line that no longer has custom length selected.

**Cross-reference — `tresse_frontend/src/store/serverCartSlice.ts`:**
that file's `postCartItem` helper deliberately never sends
`custom_length_cm`/`custom_length_surcharge` in its request body, with
an inline comment explaining exactly this read-only/server-snapshot
behavior — the frontend guide's own entry for that file documents this
in detail, including that it was briefly flagged as a potential
data-loss bug (an internal audit finding, referred to there as "P0-03")
before reading this exact serializer code showed it wasn't one: sending
those two fields from the client would have been pure dead weight, since
`validate`/`_apply_custom_length_snapshot` discard and recompute them
server-side regardless of what arrives in the request body.

**What it talks to:** `products/models.py` (all eleven models except
`Review`/`EmailLog`). Used by `products/views.py`'s `CartAPIView`/
`CartItemAPIView` (`CartItemSerializer`, `CartSerializer`) and
`ProductViewSet`/`WishlistViewSet` (`ProductSerializer`). Frontend:
`store/serverCartSlice.ts` (cart endpoints), `api/products.ts`/
`view/ProductCatalog.tsx`/`view/ProductDetails.tsx`/`view/WishList.tsx`
(product list/detail payloads).

**Watch out for:**
- **The `allows_custom_length` check happens twice, in two different
  places, against the same `product_size.product`**: once in `validate()`
  (raising `ValidationError` if `custom_length_selected` is truthy but
  the product doesn't allow it), and again inside
  `_apply_custom_length_snapshot` (raising the **exact same** error
  message a second time). Since `_apply_custom_length_snapshot` only
  ever runs from `create()`/`update()`, which DRF only calls **after**
  `validate()` has already succeeded, the second check is currently
  unreachable in the normal request flow — it would only matter if some
  other code path called `_apply_custom_length_snapshot` directly
  without going through `is_valid()` first (no such call site exists in
  this codebase today), or if the product's `allows_custom_length`
  somehow changed **between** `validate()` running and `create()`/`update()`
  being called moments later in the same request — a narrow, unlikely-
  but-not-impossible race if this serializer's usage pattern ever
  changed (e.g. validation and save split across two different requests,
  which isn't how `CartItemAPIView` uses it today).
- **`quantity`'s validation lives partly in `extra_kwargs`
  (`min_value=1`) and partly in `_get_requested_quantity`'s manual
  `int(...)` coercion inside `validate()`** — two different mechanisms
  enforcing overlapping rules (DRF's own field-level `min_value` would
  already reject `0`/negative before `validate()` even runs, in the
  normal case where `quantity` arrives as a JSON number) — the manual
  check exists specifically for a **non-numeric** string value DRF's
  own coercion might not cleanly reject the same way, and for the
  fallback-to-instance-value case on a partial update where `quantity`
  isn't in `attrs` at all and the raw model value (already an `int`) is
  used directly.

**Interview questions:**
- *Q: Why are `custom_length_cm` and `custom_length_surcharge` declared
  explicitly on the serializer with `read_only=True`, rather than just
  leaving them out of `Meta.fields` entirely if the client should never
  set them?* — They still need to appear in the **response** (a
  `GET`/the object returned after `POST`/`PUT` needs to show the
  customer what surcharge was actually applied) — a field genuinely
  excluded from `Meta.fields` wouldn't be serialized in the output at
  all; `read_only=True` is what gives "shown in responses, silently
  ignored on input" in one declaration, which is exactly the contract
  this field needs.
- *Q: Walk through what happens if a customer adds a custom-length item
  to their cart, and the product's `custom_length_surcharge` is changed
  by an admin an hour later, before the customer checks out.* — The
  existing `CartItem` row keeps whatever surcharge was snapshotted at
  the moment it was added (or last updated) — nothing re-syncs a cart
  line against a live product price after the fact. The customer would
  see the old surcharge until they either remove and re-add the item, or
  perform any update that goes back through `_apply_custom_length_snapshot`
  with `custom_length_selected` still truthy (which re-reads the
  **current** `product.custom_length_surcharge` at that moment) — a
  quantity-only `PUT`, for instance, would still pass back through
  `_apply_custom_length_snapshot` (called unconditionally from `update()`)
  and would therefore **also** silently refresh the surcharge to
  whatever it currently is, even though the customer only meant to
  change quantity.
- **Harder follow-up:** *Q: `_get_other_cart_quantity` excludes
  `self.instance` "on an update" — but on a **create** (`self.instance
  is None`), is there any risk of a request double-counting the very
  line it's about to create?* — No — on create, the new `CartItem`
  doesn't exist yet at the moment `_get_other_cart_quantity` runs (it
  queries `CartItem.objects.filter(cart=cart, product_size=product_size)`
  against rows that are already persisted), so every row the query finds
  is genuinely a different, pre-existing line; there's nothing to
  exclude because there's nothing to accidentally include. The exclusion
  only matters for update, where the very row being validated **already
  exists** in the table the query is scanning and would otherwise count
  itself once in `other_cart_quantity` and then again via the
  `+ quantity` term in `requested_cart_total = other_cart_quantity +
  quantity`, silently halving the effective limit for any update to an
  existing line (e.g. a size with 5 available and one existing line of
  quantity 3 would, without the exclusion, compute
  `other_cart_quantity=3` even when trying to update that same line to
  `quantity=3` again — a no-op change — and reject it as `3 + 3 = 6 > 5`).

### `products/admin.py`

**What it is:** admin registrations for all eleven models except
`ProductWishlist`/`Review`... **actually `Review` is registered**
(`ReviewAdmin`) — only `ProductWishlist` has no admin registration at
all (**unverified** whether that's deliberate, since wishlist entries
are arguably not something staff need to browse directly, versus every
other user-generated-content model in this app having one).

**Notable pieces:** `ProductAdmin` uses `SortableAdminMixin`
(drag-to-reorder in the changelist, backing `sort_order` — the field
`ProductViewSet.reorder`, below, also writes to, via a completely
separate code path: the admin's drag-reorder and the API's `PATCH
.../reorder/` action both mutate the same field independently, with no
shared code between them) and a custom `ProductAdminForm` that renders
`collections` as checkboxes (`CheckboxSelectMultiple`) instead of the
default multi-select widget. `ProductImageInline`
(`SortableInlineAdminMixin`) has its own `preview` method — a **fourth**
independent "guard `.url`" implementation (see `models.py`'s Watch out
for above). `ProductAdmin.color_preview` renders either the swatch image
(if set, itself `try/except`-guarded) or a plain CSS color swatch from
`color_hex` as a fallback, or an em-dash if neither is set.
`EmailLogAdmin` is **fully read-only** — `has_add_permission`/
`has_change_permission`/`has_delete_permission` all hard-coded `False`,
so this table is genuinely append-only from the admin's perspective
(rows can still be deleted directly via the database/shell, just not
through this UI).

**Interview question:** *Q: `ProductAdmin`'s drag-to-reorder (via
`SortableAdminMixin`) and `ProductViewSet.reorder`'s `PATCH` action both
write to `Product.sort_order`. Is there any coordination between the
two?* — None found in this pass — they're two entirely separate code
paths (one admin-UI-triggered via `django-adminsortable2`'s own AJAX
endpoint, one a custom DRF `@action`) that happen to converge on the
same field; whichever one runs last simply overwrites whatever ordering
the other one set, with no locking, versioning, or conflict detection
between them — acceptable in practice only because both are
staff-only, low-frequency operations, not something two people are
likely to do to the same product list simultaneously.

### `products/urls.py`

```
cart/                        -> CartAPIView                          (name: user-cart)
cart/items/                  -> CartItemAPIView (POST)                (name: cart-items)
cart/items/<int:item_id>/    -> CartItemAPIView (PUT, DELETE)         (name: cart-item)
wishlist/                    -> WishlistViewSet (router)              (basename: wishlist)
wishlist/count/               -> WishlistViewSet.count                (name: wishlist-count)
<router root>                -> ProductViewSet (router)               (basename: product)
  /<pk>/wishlist/             -> ProductViewSet.wishlist               (name: product-wishlist)
  /<pk>/subscribe_back_in_stock/ -> ProductViewSet.subscribe_back_in_stock (name: product-subscribe-back-in-stock)
  /reorder/                   -> ProductViewSet.reorder                (name: product-reorder)
```

Two `DefaultRouter`-registered viewsets share this file: `wishlist`
mounted explicitly at `r"wishlist"`, and `ProductViewSet` mounted at the
router **root** (`r""`) — meaning `ProductViewSet`'s own list/detail
routes (`GET /products/`, `GET /products/<pk>/`) and every custom
`@action` on it live directly under `/products/`, while `wishlist/`'s
routes are namespaced under `/products/wishlist/`. Included at
`api/products/` by `tresse/urls.py`.

### `products/views.py`

**What it is:** `CartAPIView`, `CartItemAPIView`, `ProductViewSet`,
`WishlistViewSet`.

**`CartAPIView`** (`IsAuthenticated`, `GET` only): `get_or_create`s a
`Cart`, then **re-fetches it** by `pk` with a full
`select_related`/`prefetch_related` chain (`user`,
`items__product_size__size`,
`items__product_size__product__images`,
`items__product_size__product__category`,
`items__product_size__product__collections`) before serializing — the
`get_or_create` call itself doesn't carry those relations, so this
two-step "create-or-get, then re-fetch with the real query plan" pattern
avoids either an N+1 (serializing the unoptimized `get_or_create` result
directly) or fetching relations for a cart that might not have needed
creating in the first place.

**`CartItemAPIView`** — three methods, no `Serializer`-class-level
`queryset`/`serializer_class` (a plain `APIView`, not a `ModelViewSet`),
each wrapped in its own `transaction.atomic()`:
- **`post`**: validates `product_size_id` is present and an integer
  before opening the transaction at all (a `400` for a missing/malformed
  id needs no lock). Inside the transaction: `get_or_create`s the cart,
  then **re-fetches it with `select_for_update()`** (a second query,
  deliberately — `get_or_create` itself can't be combined with
  `select_for_update` in one call), locks the target `ProductSize` row
  the same way, builds a mutable copy of the request payload with
  `product_size_id` forced to the **locked** row's own id (defensive —
  ensures the serializer validates against the exact row this request
  already holds a lock on, not a stale unlocked read), defaults
  `quantity` to `1` if blank, then validates+saves via
  `CartItemSerializer(data=payload, context={"request":..., "cart": cart})`.
  A `serializers.ValidationError` inside the `try` is explicitly
  **re-raised** (not swallowed) — so DRF's own exception handler still
  turns it into the normal `400` response; the `try/except` here exists
  to make the *lock scope* explicit (everything that needs the row locks
  happens inside it), not to intercept validation errors. After the
  transaction closes, re-fetches the created item with its own
  `select_related`/`prefetch_related` chain for the response — the same
  "write inside a lock, re-fetch with a richer query plan for the
  response" pattern `CartAPIView` uses.
- **`put`**: same locking shape — locks the user's `Cart`, then the
  target `CartItem` (`404` if not found or not owned by this user — the
  ownership check is baked directly into the `filter(id=item_id,
  cart=cart)`, not a separate permission check), then the item's own
  `ProductSize`, force-sets `product_size_id` back onto the payload
  (**so a client cannot change which product/size a cart line points to
  via this endpoint**, even if the request body included a different
  `product_size_id` — the line's identity is fixed once created; only
  quantity/measurements can change through `PUT`), validates+saves via
  `CartItemSerializer(item, data=payload, partial=True, ...)`.
- **`delete`**: the **only** one of the three methods that does **not**
  use `select_for_update()`/an explicit transaction at all — a plain
  `get_object_or_404` for the cart, then the item (scoped to that cart,
  same ownership-via-filter pattern), then `.delete()`. No lock is taken
  before the delete.

**`ProductViewSet`** (`ReadOnlyModelViewSet`, `AllowAny`): `list`/
`retrieve` only (no create/update/delete through the viewset's own
routes) plus four custom pieces.
- **`get_queryset`**: the base queryset with `select_related`
  (`category`, `group`) and a `prefetch_related` chain that includes
  **`group__products`/`group__products__images`** — prefetching every
  *other* product in the same color group, and *their* images too, for
  **every** product in the result set — this is what lets
  `get_variants` (`serializers.py`, above) avoid a fresh query per
  product when building the color-variant list, at the cost of
  prefetching data that's wasted for the (likely common) case of a
  product with no group at all. Annotates `_in_stock` via `Exists(...)`
  unconditionally (every request gets this annotation, whether or not
  the `in_stock` filter param is even used — it's what
  `ProductSerializer.get_in_stock` reads to avoid its own per-object
  fallback query) and `_is_in_wishlist` **only if the requester is
  authenticated** (an anonymous request never gets this annotation, so
  every product's `get_is_in_wishlist` falls back to its `False`-for-
  anonymous branch, which never queries `ProductWishlist` at all for
  that case). Also applies the manual `category`/`collection` filtering
  documented in `filters.py`'s Watch out for above, **in addition to**
  whatever `ProductFilter` (the `filterset_class`) does — ends with
  `.distinct()` (needed because the `collections`
  `ManyToManyField`/`group__products` joins can otherwise multiply rows).
- **`get_serializer_context`**: adds `request` — without this override,
  a `ReadOnlyModelViewSet`'s default context already includes `request`
  in modern DRF, making this override **redundant** in current DRF
  versions specifically for that key (**unverified** which DRF version
  this project pins and whether the override predates a DRF version
  where it was actually necessary); harmless either way.
- **`wishlist`** (`@action`, `POST`/`DELETE`, `IsAuthenticated`):
  `get_or_create`/`.delete()` on `ProductWishlist`, returning just
  `{"is_in_wishlist": true/false}` — no updated product payload, no
  wishlist count. `store/wishListSlice.ts`'s `inc`/`dec` (per the
  frontend guide) are the optimistic-UI mechanism that exists precisely
  because this endpoint's own response doesn't include a fresh count the
  caller could otherwise read directly.
- **`subscribe_back_in_stock`** (`@action`, `POST`, `AllowAny`,
  stock-subscribe throttles): authenticated users' `request.user.email`
  is used automatically (ignoring any `email` the request body might
  contain); anonymous requests read `email` from the body and validate
  it with `django.core.validators.validate_email`. `get_or_create`s the
  `StockSubscription` — and, **separately**, if the request is
  authenticated but the found/created subscription has no `user` set yet
  (e.g. a guest subscribed with this email before creating an account,
  and is now subscribing again while logged in with the same address),
  **backfills** `subscription.user` onto the existing row rather than
  creating a second one — `unique_together = ("product", "email")` is
  what makes this safe: the `get_or_create` call is guaranteed to find
  the existing row by email rather than risk a duplicate.
- **`reorder`** (`@action`, `PATCH`, `IsAdminUser`): expects
  `{"items": [{"id": ...}, ...]}`; the **array's own order** is what
  becomes the new `sort_order` (`enumerate(items)`, index → `sort_order`)
  — a malformed/missing `id` in any one array entry is silently skipped
  (`continue`), not rejected outright, so a partially-malformed request
  still applies whatever valid entries it did contain rather than
  failing the whole batch.

**`WishlistViewSet`** (`ReadOnlyModelViewSet`, `IsAuthenticated`): `list`
only really matters here (`retrieve` is technically available too, via
the same `ReadOnlyModelViewSet` base, but nothing in the frontend guide's
own reading of `view/WishList.tsx` suggests it's used for single-item
fetches). `get_queryset` filters `Product` to just the ids in the
user's `ProductWishlist`, with the **same** `select_related`/
`prefetch_related` chain `ProductViewSet.get_queryset` uses, plus
`_is_in_wishlist` **hardcoded to `Value(True, ...)`** rather than an
`Exists(...)` subquery — a reasonable shortcut, since every product this
queryset returns is, by construction, already in the wishlist; no query
is needed to confirm what's already guaranteed by the `filter(id__in=
wish_ids)` clause. A separate `@action`, `count` (`GET
/products/wishlist/count/`), returns just `{"count": n}` — the endpoint
`store/wishListSlice.ts`'s `fetchWishlistCount` thunk calls.

**What it talks to:** every serializer in `products/serializers.py`
except `ProductSizeInlineSerializer`/`ProductGroupSerializer`/
`ProductColorVariantSerializer` (used only indirectly, nested inside
`ProductSerializer`), `products/filters.py` (`ProductFilter`),
`products/throttles.py`. Frontend: `api/products.ts` (`fetchProducts`),
`store/serverCartSlice.ts` (all four cart endpoints),
`store/wishListSlice.ts` (`count`), `view/ProductCatalog.tsx`/
`view/ProductDetails.tsx` (wishlist toggle, back-in-stock subscribe),
`view/WishList.tsx`.

**Watch out for:**
- **`CartItemAPIView.delete` is the one write path in this file with no
  row lock at all** — every other mutating method
  (`post`/`put`, and, outside this class, `ProductViewSet.reorder`) opens
  a `transaction.atomic()` and takes `select_for_update()` locks before
  writing; `delete` goes straight to `.delete()` with no transaction or
  lock. In practice, deleting a row concurrently with something else
  reading/writing that same row is a narrower risk than the
  quantity-vs-stock races the other methods are guarding against, but
  it's a real asymmetry in this file's own locking discipline.
- **`get_queryset`'s manual category/collection filtering plus
  `ProductFilter`'s own handling of the same two params** is the
  `?category=women` bug documented in `filters.py`'s own Watch out for
  above — restated here because this is the file where the redundant,
  alias-blind manual filter actually lives.
- **`get_serializer_context`'s `request` injection is duplicated between
  `ProductViewSet` and `WishlistViewSet`** — identical three-line
  override in both classes, not factored into a shared base/mixin, even
  though both viewsets otherwise share most of their `get_queryset`
  logic too (the `select_related`/`prefetch_related` chain is copy-pasted
  between the two, not extracted into a helper function either).

**Interview questions:**
- *Q: Why does `CartItemAPIView.post` force `product_size_id` onto the
  payload to the **locked** row's own id, rather than trusting whatever
  `product_size_id` the client actually sent?* — By the time that line
  runs, the code has already resolved and locked a specific `ProductSize`
  row (`product_size = ProductSize.objects.select_for_update()...first()`)
  — re-writing the payload to that row's confirmed id (rather than the
  client's raw, unlocked input) guarantees the serializer that validates
  stock/eligibility next is checking the **exact same row** the
  transaction is holding a lock on, closing any gap between "which row
  did we lock" and "which row does the serializer think it's validating
  against."
- *Q: `subscribe_back_in_stock` is reachable by both authenticated and
  anonymous requests, on the same `AllowAny` action. What stops an
  authenticated user's request from ever hitting the anonymous
  email-from-body branch?* — The `if request.user.is_authenticated: ...
  else: ...` branch is checked first and is exhaustive — an authenticated
  request always takes the `request.user.email` branch and never reads
  `request.data.get("email")` at all, regardless of what the body
  contains; there's no way for an authenticated caller's request body to
  override whose email gets used.
- **Harder follow-up:** *Q: `ProductViewSet.get_queryset` annotates
  `_is_in_wishlist` only for an authenticated request. Trace exactly what
  `ProductSerializer.get_is_in_wishlist` does for an anonymous request to
  `GET /products/`, and confirm there's no query-per-product cost hidden
  in that path.* — For an anonymous request, `_is_in_wishlist` is never
  set on any product instance, so `getattr(obj, "_is_in_wishlist", None)`
  returns `None` for every product, which `get_is_in_wishlist` treats as
  "no annotation" and falls into its fallback branch — but that fallback
  itself checks `user and user.is_authenticated` **first**, and for an
  anonymous request `request.user` is Django's `AnonymousUser`, whose
  `is_authenticated` is `False` by design — so the fallback returns
  `False` immediately without ever reaching the
  `ProductWishlist.objects.filter(...)` query. No query-per-product cost
  exists for the anonymous path; the annotation exists purely to avoid
  that cost for the **authenticated** path, where the fallback would
  otherwise genuinely run once per product per page.

### `products/tests.py`

535 lines, ten test classes, no shared base test case — each class
builds its own fixtures via a local `_make_product(**kwargs)` helper
(defaults: `name="Sweater"`, `price=Decimal("50.00")`) and the shared
`testing_helpers.make_user` (imported as `from testing_helpers import
make_user` — note the module's own internal header comment says `#
tresse_backend/test_utils.py`, a stale filename that no longer matches
where this file actually lives, `testing_helpers.py` at the repo root;
harmless, but a real inconsistency if anyone goes looking for
`test_utils.py` based on that comment alone).

**What's mocked, by area:**
- `products.signals.send_back_in_stock_email` is mocked in every
  `StockSignalTestCase` test — none of them let a real email attempt
  happen; each also wraps the triggering `.save()` in
  `self.captureOnCommitCallbacks(execute=True)` (see `signals.py`'s own
  "harder follow-up" interview question above for exactly why that
  wrapper is load-bearing, not optional, for these specific assertions).
- `ImageUrlFailureTestCase` (added for the "Catalog 500 on unguarded
  image URLs" fix, `docs/fixes-2026-09.md`) patches
  `django.db.models.fields.files.FieldFile.url` itself — a `PropertyMock`
  raising `ValueError` — rather than mocking any of this app's own
  code, so the test exercises the real `ProductImageSerializer`/
  `ProductSerializer`/`ProductColorVariantSerializer` methods against a
  genuinely-raising `.url` property, the same failure mode a real broken
  storage backend would produce.
- No test in this file mocks `django_filters`/DRF's filter backends —
  `ProductFilterTestCase` calls `ProductFilter(...).qs` directly against
  a real, unmocked queryset, and `ProductListAPITestCase`/
  `ProductReorderTestCase` go through the real `APIClient` end to end.

**What's asserted, by area:**
- **`CartItemAddTestCase`/`CartItemUpdateDeleteTestCase`**: the full
  `CartItemSerializer.validate()` chain from the outside — stock limits
  (including the aggregate-across-lines case,
  `test_adding_same_size_twice_aggregates_against_stock`, whose own
  inline comment calls it out as the "ключевой" (key) test for exactly
  the migration-`0019` consequence documented in `serializers.py`'s
  section above), out-of-stock/unavailable-product rejection, ownership
  (`404`, not `403`, for another user's cart item — consistent with
  `CartItemAPIView`'s own `filter(..., cart=cart)`-based lookup
  returning nothing rather than a distinguishable "exists but not
  yours" signal), and the custom-length snapshot actually landing on the
  created row with the product's current `custom_length_cm`/
  `custom_length_surcharge` values.
- **`WishlistActionTestCase`**: add/remove/idempotent-add (posting twice
  creates exactly one row), the count endpoint, and the
  `401` for an unauthenticated wishlist toggle.
- **`StockSubscriptionTestCase`**: anonymous-with-email,
  authenticated-uses-own-email, both invalid/missing email rejected,
  duplicate subscription staying a single row.
- **`ProductReorderTestCase`**: `403` for a non-admin, a real
  `sort_order` swap for an admin, and a non-list `items` payload
  rejected with `400`.
- **`ProductFilterTestCase`**: the category alias map, price range, and
  in-stock filtering — directly against `ProductFilter(...).qs`, not
  through the full view stack, so this specific test class would **not**
  catch the `get_queryset` manual-filter interaction documented in
  `filters.py`'s Watch out for above (that bug only manifests when both
  filters run together, which only happens through the real view).
- **`ImageUrlFailureTestCase`**: the direct regression coverage for the
  "Catalog 500" fix — each of the three touched serializer methods
  returns `None` for its one field while the rest of the payload,
  including a nested nested list (`ProductSerializer`'s own `images`),
  stays intact.
- **`StockSignalTestCase`**: the full restock-detection matrix from
  `signals.py`'s `notify_when_back_in_stock` — zero-to-positive sends,
  zero-to-zero doesn't, a decrease doesn't, positive-to-positive
  doesn't, an already-notified subscription isn't notified twice — this
  is the direct regression coverage for both [[P0-01]] (the signal never
  firing at all) and [[P0-02]] (the signal firing too eagerly), both in
  `docs/fixes-2026-09.md`.

**Interview question:** *Q: `test_adding_same_size_twice_aggregates_against_stock`
posts the same `product_size_id` twice with `quantity: 3` each, against
a `ProductSize` with `quantity=5`, and expects the **second** request to
be rejected. Why does this test only make sense given migration `0019`'s
history?* — Because it's asserting that two separate `CartItem` rows for
the same `(cart, product_size)` are even possible to create in the first
place (the first `POST` succeeds and creates one), and that
`_get_other_cart_quantity`'s summing logic then correctly catches the
second request as pushing the combined total over the available stock —
if `CartItem` still had the `unique_together` constraint migration
`0018` originally added (before `0019` dropped it), the **first**
successful `POST` would have already created the only row the DB allows
for that pair, and a second `POST` for the same size would have to be
handled as an update-in-disguise (or rejected by the DB) rather than
ever reaching the "two rows, sum their quantities" code path this test
is actually exercising.

---

## Backend — orders

This is where the money actually moves: every file under
`tresse_backend/orders/`. Unlike `accounts`/`products`, there is no
customer-facing order-*creation* endpoint at all — the only code path
that ever inserts an `Order` row is the Stripe webhook in
`views_stripe.py`, and every other file in this section exists to
support, display, or unwind what that one webhook handler created. The
webhook and the three-phase refund pattern it shares with
`views.py`/`admin.py` get the deepest treatment below; the sections on
`models.py`, `admin.py`, `emails.py` and the serializers are shorter but
each still carries at least one verified, non-obvious finding.

### `orders/models.py`

**What it is:** `Order` and `OrderItem` — the two models everything else
in this app reads or writes. No other model in `orders/` exists.

**`_gen_public_id(prefix="TR")`**: builds the customer-facing order
number — `TR-YYYYMMDD-XXXXXX`, where the date is `timezone.localdate()`
(local, not UTC) and the six-character suffix is drawn from
`secrets.choice` over a 32-character alphabet that deliberately excludes
visually ambiguous characters (no `0`/`O`, no `1`/`I`, no `L`) — a
support agent reading the code out loud over the phone can't confuse a
digit for a letter. `secrets.choice`, not `random.choice`,
is used specifically because this is a customer-facing identifier
staff search by (`OrderAdmin.search_fields` includes `public_id`), not a
security token — the module doesn't need cryptographic unpredictability
here so much as it needs to not import `random` and invite a reviewer to
ask why a public identifier isn't using the CSPRNG the rest of the
codebase's tokens do.

**`Order.save()`** does three things before delegating to the real
`save()`, all guarded so they only ever *fill in* a value, never
overwrite one already set:
- `email` defaults to `self.user.email` if the order has a `user_id` but
  no `email` of its own yet — but only on **first** save with `email`
  unset; a `User.email` change afterward never retroactively touches an
  already-saved `Order.email`, which is intentional (see `models.py`'s
  entry in Questions by topic's "Data privacy and consent" below — an
  order is a snapshot of what was true at purchase time).
- `subtotal_amount` defaults to `total_amount` if a `total_amount` was
  passed but `subtotal_amount` wasn't — in practice this only fires for
  an `Order` created by hand (a test, an admin "Add order" form), never
  for the webhook's own `Order.objects.create()` call, which always
  passes both fields explicitly from the Stripe session's own
  `amount_total`/`amount_subtotal`.
- **`public_id` generation is a check-then-act loop**: `while True:
  candidate = _gen_public_id(); if not
  Order.objects.filter(public_id=candidate).exists(): break` — this
  `exists()` check is itself racy (two concurrent `Order.save()` calls
  could both pass it for the same candidate before either has inserted),
  but the field's own `unique=True` constraint is the actual backstop: a
  genuine collision wouldn't silently duplicate a public id, it would
  raise `IntegrityError` on the losing `save()` — a race converted into
  a visible failure rather than a silent one. At six characters from a
  32-symbol alphabet (~1 billion combinations) and this store's order
  volume, a real collision inside the same save-loop window is
  vanishingly unlikely; the constraint exists as a correctness backstop,
  not because collisions are expected.

**`OrderItem`**: one row per cart line at the moment of purchase, not a
live reference to the product's current state — `product`
(`on_delete=PROTECT`, so a `Product` can never be deleted while any
order still references it — contrast `Order.user`'s `on_delete=CASCADE`,
below), `product_size` (nullable/`PROTECT`, for the same reason),
`unit_price` (the price actually charged, frozen at purchase — see
`views_stripe.py`'s `_item_unit_price`), `return_policy` (a `TextChoices`
snapshot of `Product.return_policy` *at the time of purchase* — a
product's return policy changing later doesn't retroactively change
whether an already-placed order for it can be returned), and the full
set of custom-measurement/custom-length fields copied off the `CartItem`
that produced it.

**What it talks to:** `products/models.py` (`Product`, `ProductSize`,
`Cart`/`CartItem` — the last two only via `views_stripe.py`, not
imported here), `accounts`' `User` via `get_user_model()`. Frontend:
every field on `OrderReadSerializer` (below) is what
`view/OrderHistory.tsx` and `view/Order.tsx` render directly.

**Watch out for:**
- `Order.user` is `on_delete=CASCADE` — hard-deleting a `User` row would
  delete that customer's entire order history with it. No endpoint in
  this codebase actually hard-deletes a `User`;
  `DeleteAccountAPIView` (`accounts/views.py`) only soft-deletes via
  `is_active`/`deleted_at`, exactly so financial records like `Order`
  survive account deactivation. The `CASCADE` would only matter for a
  manual hard-delete from a Django shell or the admin's raw delete
  action — not a path any UI in this app exposes.
- `status` has three choices (`pending`/`paid`/`canceled`) but
  **`pending` is effectively unreachable in production**: the only code
  path that creates an `Order` at all (`views_stripe.py`'s webhook)
  always passes `status="paid"` explicitly. `OrderCreateSerializer`
  (`orders/serializers.py`, below) hints at a design where an order
  might once have been created before payment, but no view uses that
  serializer today — `pending` only appears via a test or a manually
  created admin row.
- `Order.save()`'s email-default check (`if self.user_id and not
  self.email`) reads `self.user.email`, which triggers a database query
  for the related `User` on every save of an order with no email set
  yet — a minor N+1 risk only if `Order.save()` is ever called in a loop
  without the user already having been fetched; every current call site
  (`views_stripe.py`'s webhook, the admin actions) already has the
  `user`/`request.user` object in hand, so this doesn't bite in
  practice today.

**Interview questions:**
- *Q: Why generate `public_id` with `secrets.choice` instead of
  `random.choice`, when this identifier isn't protecting anything the
  way a password-reset token is?* — It's less about needing
  cryptographic unpredictability here and more about not having a
  weaker RNG anywhere near a financial record's identifier at all —
  `random` is a Mersenne Twister, predictable given enough output, and
  there's no reason to reach for it just because this particular string
  isn't a secret; `secrets` is the module this codebase already uses for
  actual secrets (see `newsletter/tokens.py`), so reusing it here is the
  path of least surprise, not a security requirement specific to order
  numbers.
- *Q: What actually stops two orders from ending up with the same
  `public_id`, given the generation loop's `exists()` check is racy?* —
  The `unique=True` constraint on the field itself. The `exists()` check
  is a fast-path that makes a collision retry astronomically unlikely to
  ever be needed, but it is not what *guarantees* uniqueness — the
  database is. A genuine race would surface as an `IntegrityError` on
  the losing `save()` call (uncaught here — it would propagate to
  whatever called `.save()`), not as two orders silently sharing a
  number.
- **Harder follow-up:** *Q: `Order.email` is filled in from
  `self.user.email` only when unset, and never touched again after
  that. Six months later, the customer changes their account email in
  `accounts/views.py`'s `ProfileAPIView`. What does their old order show
  now, and is that a bug?* — The old order keeps showing the email it
  was placed under — `Order.email` is a snapshot, not a live foreign-key
  lookup, and `ProfileAPIView`'s `PUT` only ever touches `User.email`
  and `UserProfile`, never any existing `Order` row. This is correct
  behavior for a financial record (the receipt should reflect what was
  true when the purchase happened, the same reasoning that keeps
  `Order.address`/`full_name` as their own columns rather than a live
  join to `UserProfile`), not a missed cascade — see this guide's
  "Data privacy and consent" question in Questions by topic for the
  parallel case of a deactivated account's orders.

### `orders/migrations/`

Seventeen migrations, almost all additive — this app's schema grew field
by field rather than through any large restructuring. `0001_initial`
creates `Order`/`OrderItem` with only the fields a first pass at
checkout needed (`full_name`, `address`, `city`, `postal_code`,
`country`, `payment_method`, `created_at` — notably no `state`, `email`,
`status`, or any Stripe field yet). `0002` adds `currency`, `email`,
`status`, `stripe_checkout_id`, `stripe_payment_intent`, `total_amount`
in one pass. `0003` adds `OrderItem.product_size`. `0004` adds the
billing/shipping `state` field — added later than `city`/`postal_code`/
`country`, which is why it wasn't in the initial model at all. `0005`–
`0007` are a small, genuine back-and-forth on card display fields: `0005`
adds `card_brand`/`card_last4`; `0006` **removes** `card_last4` again in
the same breath it adds `cardholder_name`, replacing it with a
differently-named `ccard_last4`; `0007` renames `ccard_last4` straight
back to `card_last4` — three migrations to end up exactly where `0005`
started plus `cardholder_name`, a rename typo/reconsideration rather
than a schema change with any lasting effect. `0008` is a cleanup pass:
widens `payment_method`'s choices with a default, adds `unique=True` to
`stripe_payment_intent` (**this is the migration that makes the
webhook's duplicate-order idempotency check into a real database
guarantee, not just an application-level convention** — see
`views_stripe.py`'s Interview questions below), and widens
`OrderItem.size`/`unit_price`. `0009` adds `public_id`. `0010` adds the
seven `OrderItem` custom-measurement fields. `0011` adds
`subtotal_amount`/`discount_amount`/`discount_code` and widens
`OrderItem.size` again (16 → 50 characters). `0012` adds the policy-
consent fields (`policy_accepted`, `policy_version`,
`policy_accepted_at`, `custom_size_final_sale_acknowledged`). `0013`
adds `tax_amount`. `0014` is the largest single migration in this app —
`delivered_at`, the entire refund field group (`refund_status`,
`refund_initiated_at`, `stripe_refund_id`), the entire return-workflow
group (`return_status` with its full seven-choice `choices=` list,
`return_requested_at`, `return_approved_at`, `return_received_at`,
`return_refunded_at`, `return_rejected_at`), and an `AlterField` on
`status` (adding the `default="pending"` that's on the model today) —
one migration for what `models.py`'s own `# ---` section comments group
into "STRIPE REFUND" and "RETURN WORKFLOW" today. `0015` adds
`OrderItem.return_policy`. `0016` adds the
three custom-length fields. `0017` — the most recent — adds
`tracking_number`, `tracking_carrier`, `shipped_at`, the [[P1-07]] fix
that made shipping/delivery notifications possible at all.

### `orders/apps.py` and `orders/urls.py`

**`apps.py`** is the minimal `AppConfig` — `default_auto_field` and
`name` only, no `ready()` override. Unlike `products/apps.py` (which
exists specifically to import `products/signals.py` and connect the
back-in-stock receiver — see the Backend — products section's own entry
and [[P0-01]]), `orders` has no signals module and nothing for `ready()`
to do.

**`urls.py`** wires five routes under whatever prefix `tresse/urls.py`
mounts this app at: `my/` (`MyOrdersAPIView`), `<id>/cancel/`
(`CancelOrderAPIView`), `<id>/return/` (`RequestReturnAPIView`) — all
three from `views.py` — plus `create-checkout-session/` and `webhook/`
from `views_stripe.py`. This file is also the concrete evidence for
[[P1-18]]: it only ever imported `create_checkout_session`/
`stripe_webhook` from `views_stripe`, never from the ~700-line duplicate
copy that used to sit in `views.py` — which is exactly why that
duplicate could rot for as long as it did without breaking anything a
user could reach.

### `orders/throttles.py`

**What it is:** `StripeIntentAnonThrottle`/`StripeIntentUserThrottle`
(scopes `stripe_intent_anon`/`stripe_intent_user`), and — verified by
reading `tresse/settings.py` directly — both scopes have real,
deliberately tight rates configured in `DEFAULT_THROTTLE_RATES`
(`5/min` anon, `20/min` user, under a `# Stripe intent spam / abuse`
comment).

**Watch out for — this is dead code, and the reason it looks alive is
worth spelling out:** neither class is imported anywhere outside this
file. `create_checkout_session` (`views_stripe.py`) has no
`@throttle_classes` decorator at all, so it falls through to
`REST_FRAMEWORK`'s global `DEFAULT_THROTTLE_CLASSES` —
`AnonRateThrottle`/`UserRateThrottle` at the generic `anon`/`user`
scopes (`60/min`/`300/min`). Since the view is `IsAuthenticated`-only,
`AnonRateThrottle` never applies to it in practice; what actually gates
repeated Checkout-Session creation today is the **generic 300/min
per-user rate**, not the `20/min` `stripe_intent_user` rate these two
classes and their settings entry were clearly built for. This is the
same shape as `accounts/views.py`'s duplicate throttle classes (per that
section above) and `orders/views.py`'s pre-[[P1-18]] dead webhook
copy: a piece of Stripe-abuse-prevention infrastructure that reads as
wired up — a dedicated module, a settings entry with a comment
explaining its purpose — but was never actually attached to the one
view it names itself after.

**Interview question:** *Q: If someone asked you to actually fix this,
what's the one-line change, and what would you want to verify before
shipping it?* — Add `throttle_classes = [StripeIntentUserThrottle]` (no
`Anon` variant needed, since the view requires authentication) to
`create_checkout_session`. Before shipping: check whether `20/min` is
actually generous enough for a legitimate customer who abandons and
retries checkout a few times in a session (each retry calls this
endpoint again, since there's no idempotency key on the Stripe session
creation itself — see `views_stripe.py`'s Watch out for below) — a rate
tuned purely for "stop abuse" could accidentally throttle a real,
frustrated customer mid-checkout.

### `orders/serializers.py`

**`OrderItemReadSerializer`**: read-only, all fields (`read_only_fields
= fields`) — `product_name` sourced from `product.name` rather than a
`ForeignKey`'s default `__str__`, so the frontend gets a plain string
without needing a second lookup.

**`OrderReadSerializer`**: also fully read-only, nests
`OrderItemReadSerializer` under `items`. This is the shape
`MyOrdersAPIView`, `CancelOrderAPIView`, and `RequestReturnAPIView` all
return — every field `view/OrderHistory.tsx` and `view/Order.tsx` render
comes from here, including the [[P1-07]] tracking fields and the full
return-workflow timestamp set.

**`OrderCreateSerializer`** — **unused.** Its own docstring says "Client
does not send: items, subtotal, discount, tax, total, Stripe IDs, order
status, return status," describing a design where a client would `POST`
shipping/contact fields to create a *pending* order before payment. No
view in this codebase imports or instantiates it — confirmed by
`grep -rn "OrderCreateSerializer"` finding only its own definition. This
is the same class of finding as `Order.status`'s unreachable `pending`
default (`models.py`, above) and the throttle classes just above: three
independent pieces of evidence for the same underlying fact, that this
codebase's order-creation design changed at some point from
"create-then-pay" to "pay-then-webhook-creates," and not every artifact
of the earlier design was cleaned up when the newer one landed.

**Interview question:** *Q: If `OrderCreateSerializer` is dead, why not
delete it the way [[P1-18]] deleted the dead duplicate webhook code in
`views.py`?* — **Unverified** why it specifically survived — one
plausible reading, from the pattern across this file/`models.py`/
`throttles.py` together, is that `views.py`'s duplicate webhook code was
caught because it was large, security-relevant, and actively
maintained-looking (someone could believe they were fixing a live bug
in it); a small, clearly-labeled, never-imported serializer with an
explanatory docstring is a much easier thing to skim past during a
cleanup pass focused on behavior, since deleting it changes nothing any
test or running code path depends on either way.

### `orders/emails.py`

**What it is:** every outbound email this app sends, plus the ops-alert
helper the webhook leans on. Six of the seven public functions here are
thin: build a subject with `_order_label(order)` (the order's
`public_id`, falling back to `#{id}`), bail out with no send at all if
`order.email` is blank, then call the shared `_send_txt_email` helper.
**The templates themselves — all six — are already covered in depth in
Backend — email templates above** (which function sends which template,
from which call site, and the [[P1-09]] public-id-in-body fix); this
section covers the sending mechanics, not the template content.

**`_send_txt_email`**: one path for every order email —
`render_to_string`, wrap in `EmailMessage` with `from_email=
_from_email()` and `reply_to=_reply_to()`, `send(fail_silently=False)`.
`fail_silently=False` means a real SMTP/Resend failure **raises** here
— every call site that matters catches it: `views_stripe.py`'s
`_send_email_after_commit` and `orders/admin.py`'s per-order email loops
each wrap their own send in `try/except Exception`, so a failed order-
confirmation or shipping email is logged and skipped rather than
crashing the request/action that triggered it — but `emails.py` itself
does not swallow anything; every `send*_email` function here can and
will raise straight up to its caller on a real send failure.

**`send_checkout_webhook_alert(reason, session_id, payment_intent_id,
amount, customer_email)`** — the [[P0-08]] alert helper `views_stripe.py`
calls from seven of the webhook's eight non-idempotent failure branches
(the eighth, stock shortage, also calls this *and* the refund/customer-
email pair below). Two independent, separately-guarded steps:
1. `sentry_sdk.capture_message(...)` with a **fingerprint of
   `["checkout-webhook-alert", reason]`** — grouping every alert for the
   same `reason` (e.g. every `cart_signature_mismatch` across every
   customer) into one Sentry issue rather than one per event, so a
   recurring problem shows up as one issue with a rising count instead
   of paging someone fresh for every occurrence. A no-op if Sentry isn't
   configured (`SENTRY_DSN` unset — see the "Test settings isolation"
   fix in `docs/fixes-2026-09.md` for why that's guaranteed true in
   tests).
2. An email to `settings.SUPPORT_EMAIL` with a plain-text dump of the
   reason, session id, payment intent id, amount, and customer email —
   **skipped entirely (not attempted) if `SUPPORT_EMAIL` isn't set**,
   though step 1 still runs regardless.

Each step has its own `try/except Exception: logger.exception(...)` —
**deliberately independent**, so a Sentry outage can't suppress the
support email, and a failing support-email send can't stop the Sentry
call from having already happened. Both together, or either one alone
failing, can never raise back into `stripe_webhook` — the webhook must
always return `200` to Stripe regardless of whether this function's own
internals succeeded.

**`send_checkout_stock_sold_out_email(to_email, amount, session_id)`**:
the one customer-facing half of the stock-shortage story — told
separately from the ops alert above, by `_refund_stock_sold_out_checkout`
in `views_stripe.py`, only after the Stripe refund call itself
succeeded.

**What it talks to:** every template in `templates/emails/orders/`
(see Backend — email templates above for the full table), `sentry_sdk`,
Django's `EmailMessage`. Called from `views_stripe.py` (confirmation,
alert, stock-sold-out), `orders/views.py` (canceled, refund-initiated),
`orders/admin.py` (shipping-confirmation, delivered).

**Watch out for:** `_reply_to()` falls back through
`SUPPORT_EMAIL` → `DEFAULT_FROM_EMAIL` → `_from_email()`'s own three-way
fallback (`DEFAULT_FROM_EMAIL` → `EMAIL_HOST_USER` →
`"no-reply@tresse.com"`) — meaning if none of `SUPPORT_EMAIL`/
`DEFAULT_FROM_EMAIL`/`EMAIL_HOST_USER` are configured at all, an order
email's `reply_to` and `from_email` both end up as the same hardcoded
`no-reply@tresse.com`, a domain that (per [[P1-16]]'s own findings)
isn't this store's live storefront domain either — an edge case only
reachable if the deployment is missing settings that should always be
present in practice.

**Interview questions:**
- *Q: Why does `send_checkout_webhook_alert` fingerprint the Sentry
  message by `reason` alone, rather than including the session id or
  payment intent?* — Grouping is the point: every occurrence of, say,
  `cart_signature_mismatch` is the same *kind* of problem worth one
  person investigating once, not once per customer it happens to —
  including a unique identifier in the fingerprint would make every
  single alert its own Sentry issue, defeating the grouping and turning
  a pattern worth noticing into background noise.
- *Q: What is the one branch of the webhook where this function's
  ops-only alert isn't the whole story, and why does that branch get
  more than the other seven?* — Stock shortage. Every other branch
  alerts a human and stops — a missing user, a signature mismatch, and
  so on are all situations where the *right* next step genuinely needs a
  person to look at the specific case. Stock shortage is the one branch
  where "give the customer their money back" is unambiguously correct
  regardless of the details, so it's the only one that also calls
  `send_checkout_stock_sold_out_email` and issues an actual refund with
  no human in the loop — see `views_stripe.py`'s
  `_refund_stock_sold_out_checkout` below.
- **Harder follow-up:** *Q: `send_checkout_webhook_alert`'s two steps
  (Sentry, email) each swallow their own exception independently. Trace
  what happens to a checkout that hits `cart_signature_mismatch` if
  *both* Sentry and the support-email send fail in the same call —
  does the customer's payment get refunded?* — No, and that's the sharp
  edge of this design: for every branch except stock shortage, this
  function *is* the entire remediation path — there's no fallback
  alerting mechanism if both of its internal steps fail on the same
  call. The webhook itself doesn't know or care whether the alert
  actually reached anyone (it can't — both failures are caught and
  logged, never raised), so it still returns `200` to Stripe. The
  customer keeps whatever charge Stripe captured, with no order, and the
  only trace of what happened is whatever `logger.exception` wrote to
  application logs — which is exactly why [[P0-08]]'s fix was "alert a
  human," not "alert a human, guaranteed": Sentry and email going down
  at exactly the same moment as a mismatched cart signature is judged an
  acceptable residual risk relative to the alternative of, say, blocking
  the webhook's `200` response on a third-party alerting call
  succeeding, which would risk turning an alerting failure into a
  payment-processing failure too.

### `orders/admin.py`

**What it is:** the *only* place four of this app's six status
transitions can happen at all — `shipped_at`, `delivered_at`, and all
four return-workflow states past `"requested"` are set exclusively from
here, never from any customer-facing endpoint. `OrderAdmin` registers
six actions in two families (shipping, return/refund) plus a read-only
`OrderItemInline`.

**`_build_tracking_url(carrier, tracking_number)`**: looks `carrier` up
(uppercased, stripped) in `TRACKING_URL_TEMPLATES`, a four-entry dict
(USPS/UPS/FEDEX/DHL). Returns `""` — silently, no error, no log — for
any carrier not in that dict or a blank `tracking_number`. Since
`Order.tracking_carrier` is free-text (`CharField`, no `choices=`, just
a `default="USPS"`), a staff member typing `"Usps"`, `"US Postal
Service"`, or any carrier outside this list of four produces an order
whose shipping-confirmation email still sends — with a real tracking
*number* in the body but a silently empty tracking *link*, since the
template only ever gets whatever `mark_shipped` passes it.

**`mark_shipped`**: for each selected order, one `transaction.atomic()`
per order (not one transaction around the whole queryset — see this
section's Interview questions) locks it, requires `status == "paid"`,
a non-empty `tracking_number`, and no `shipped_at` yet, skipping
(counted, not erroring) anything that fails those three; on success sets
`shipped_at = now()` and saves. **Only after the loop finishes** does it
send `send_shipping_confirmation_email` for every order it just shipped,
in a **second** loop, deliberately outside any transaction, each in its
own `try/except` — an SMTP failure for order #3 of ten selected orders
doesn't affect the DB write already committed for order #3, and doesn't
stop emails #4–10 from being attempted. Reports three separate counts
(`shipped`/`skipped`/`failed`) via `self.message_user`.

**`mark_delivered`**: the same two-loop shape — requires `shipped_at`
set and `delivered_at` not yet set, then sends `send_delivered_email`
outside the transaction, same per-order try/except and three-count
report.

**The return/refund family** (`approve_return`, `mark_return_received`,
`issue_stripe_refund`, `reject_return`) walk `return_status` forward:
`"requested"` → `approve_return` → `"approved"` → `mark_return_received`
→ `"received"` → `issue_stripe_refund` → `"refunded"` (Stripe status
`succeeded`) or `"refund_pending"` (anything else, later flipped to
`"refunded"` by the `refund.updated` webhook branch — see
`views_stripe.py`'s `_sync_refund_event`); `reject_return` is available
from either `"requested"` or `"approved"` and sets `"rejected"`.
`approve_return`/`issue_stripe_refund` both **re-check** the
non-returnable/custom-size rules a second time (they don't trust that
`RequestReturnAPIView` already refused those items when the return was
first requested) — but neither one re-checks `custom_length_selected`
the way `RequestReturnAPIView` does; per [[P1-19]]'s own "Observation,
not changed," a custom-length order can't reach `"requested"` through
the customer-facing API at all today, so this gap is only reachable if
`return_status` is set by hand in the admin, and it isn't covered by a
test.

**`issue_stripe_refund`** is the one action that talks to Stripe, and it
runs the identical [[P0-09]] three-phase shape as
`CancelOrderAPIView` (`views.py`, below) — lock-and-mark-`"initiating"`
in a short transaction, call `stripe.Refund.create` with **no**
transaction open, record the result in a fresh transaction — down to
reusing the same `_clear_return_refund_initiating` cleanup-on-failure
shape and an idempotency key built the same way
(`return_refund_{id}_{payment_intent}` vs. `views.py`'s
`cancel_order_{id}_{payment_intent}`). **Unlike `CancelOrderAPIView`,
this action never calls `send_refund_initiated_email` or
`send_order_canceled_email`** — confirmed directly against this file's
imports (only `send_delivered_email`/`send_shipping_confirmation_email`
are imported here) — so a return refund issued through the admin
notifies the customer of nothing; the only way they'd find out is
checking their bank statement or `return_status` on `/orders`. See
walkthrough 3 in How the pieces fit for the full return lifecycle this
gap sits inside.

**What it talks to:** `orders/emails.py` (`send_shipping_confirmation_email`,
`send_delivered_email` only), `stripe.Refund.create`, `orders/models.py`.
Nothing here is called from the frontend at all — every action in this
file is reached exclusively through the Django admin UI.

**Watch out for — `shipped_at` and `delivered_at` are locked down
inconsistently:** `shipped_at` is in `readonly_fields`, so it can only
ever be set by running `mark_shipped` — a staff member cannot type a
shipped date into the form directly. **`delivered_at` is not in
`readonly_fields`**, even though it's listed right next to
`tracking_number`/`tracking_carrier`/`shipped_at` in the same
"Shipping" fieldset — confirmed by reading both the `readonly_fields`
tuple and the fieldset definition directly. A staff member can still
type a delivery date straight into the change form and save, exactly
the way [[P1-07]] describes the *original*, pre-fix behavior ("staff had
to remember to set `delivered_at` by hand"). `mark_delivered`'s own
`shipped_at`-must-already-be-set gate is real, but it's not the *only*
way `delivered_at` can be set — it's just the only way that also sends
`send_delivered_email` and enforces the shipped-before-delivered
ordering. Since `RequestReturnAPIView`'s 14-day return window is counted
from `delivered_at` directly, a hand-typed `delivered_at` on an order
that was never actually marked shipped would still start that customer's
return-window clock, with no shipping-confirmation email ever having
gone out.

**Interview questions:**
- *Q: Why does each action wrap every order in its own
  `transaction.atomic()` inside the loop, instead of one
  `transaction.atomic()` around the whole `queryset` loop?* — So one
  order's failure can't undo work already committed for a different
  order in the same bulk action. If `mark_shipped` is run against ten
  orders and the ninth raises, one outer transaction would roll back all
  nine that already succeeded along with it; per-order transactions mean
  the first eight stay shipped and only the ninth (and whatever comes
  after) is left unprocessed — consistent with every action's
  skip/failure counts being reported as partial results, not all-or-
  nothing.
- *Q: Why does `mark_shipped` send emails in a second loop, entirely
  after the first loop that does all the database writes, rather than
  sending each order's email right after its own `transaction.atomic()`
  block inside the same loop iteration?* — Functionally the two shapes
  would behave almost identically here, since each order's DB write is
  already committed independently by the time its own atomic block
  exits — but keeping every database write in the first loop and every
  network call in the second keeps the "did the DB update succeed" and
  "did the email send succeed" concerns visibly separate in the code,
  matching this file's own three-count reporting (`shipped`/`skipped`/
  `failed` are about two different kinds of failure — an ineligible
  order vs. a failed send — and the two-loop structure is what makes
  that distinction easy to compute correctly).
- **Harder follow-up:** *Q: A staff member selects an order that is
  currently `status="paid"`, `return_status="requested"`, and runs
  `issue_stripe_refund` against it by mistake, before running
  `approve_return`/`mark_return_received` first. What happens?* — It's
  skipped, not refunded: `issue_stripe_refund`'s own eligibility check
  requires `return_status == "received"` before it does anything else,
  so an order still sitting at `"requested"` fails that check on its
  first line and is counted in `skipped`, with Stripe never called at
  all. The four-stage `requested → approved → received → refunded`
  sequence is enforced entirely by each action independently checking
  the *previous* stage's exact value — there's no separate state-machine
  object; running any action out of order just produces a same-order
  no-op counted as a skip, never an error and never a transition to the
  wrong state.

### `orders/views.py`

**What it is:** everything a *customer* can do to their own orders after
checkout — read them, cancel one, request a return on one. This file
used to also hold a byte-for-byte duplicate of the Stripe checkout/
webhook code until [[P1-18]] deleted it; what remains is exactly the
three classes below plus the small helpers they share.

**`MyOrdersAPIView`** (`IsAuthenticated`): `GET` only, no pagination
(matching `view/OrderHistory.tsx`'s own assumption — see that file's
entry above), `.order_by("-created_at")`, `prefetch_related`s every
relation `OrderReadSerializer` needs (`items`, `items__product`,
`items__product_size`, `items__product_size__product`,
`items__product_size__size`) up front, so serializing every order in the
list touches the database once, not once per order per relation.

**`CancelOrderAPIView`** (`IsAuthenticated`) is the customer-facing half
of the [[P0-09]] three-phase refund pattern this guide's Glossary
documents in general terms; here's the concrete version:
1. **Phase 1** — one short `transaction.atomic()`: `select_for_update()`s
   the order (scoped to `id=order_id, user=request.user`, so someone
   else's order id 404s instead of 403-ing — no information leak about
   whether the id exists at all), then runs six sequential eligibility
   checks in order (must exist → must be `status="paid"` → inside the
   24-hour `CANCEL_WINDOW` of `created_at` → no `return_status` already
   set → no `stripe_refund_id` already set → has a
   `stripe_payment_intent` at all → not already `refund_status ==
   "initiating"`), any of which returns immediately with a specific 400/
   404. If every check passes, sets `refund_status = "initiating"` and
   `refund_initiated_at = now()`, saves, and the `with` block exits —
   **the transaction, and the row lock with it, ends here.**
2. **Phase 2** — no transaction open at all: `stripe.Refund.create(
   payment_intent=order.stripe_payment_intent, idempotency_key=
   f"cancel_order_{order.id}_{order.stripe_payment_intent}")`. If this
   raises (`StripeError` or anything else), `_clear_cancel_refund_initiating`
   best-effort-resets the `"initiating"` marker back to empty (itself
   wrapped in its own `try/except` so a *cleanup* failure can't mask the
   real error being returned) and the view responds 400/500 — nothing
   was charged, so nothing needs reconciling.
3. **Phase 3** — a fresh `transaction.atomic()`: re-locks the same order
   by primary key, sets `status = "canceled"`, records the real
   `stripe_refund_id`/`refund_status` from Stripe's response, and — via
   two separate `transaction.on_commit(...)` calls — queues both
   `send_order_canceled_email` and `send_refund_initiated_email`. **If
   this phase itself raises**, the `"initiating"` marker is deliberately
   **left in place**, not cleared — see this section's Interview
   questions for why that asymmetry with phase 2's cleanup is the
   correct choice, not an oversight.

A response with no `id` field from Stripe (`refund.get("id")` empty)
is treated as its own failure case — `_clear_cancel_refund_initiating`
runs and the view returns `502 Bad Gateway`, distinct from every other
error path's `400`/`500`, since this specifically means "Stripe's API
gave us something we can't parse," not "the request was invalid" or
"our own code broke."

**`RequestReturnAPIView`** (`IsAuthenticated`): one `transaction.atomic()`,
no Stripe call at all (a return *request* only changes `return_status`
to `"requested"` — money doesn't move until an admin runs
`issue_stripe_refund`, days or weeks later). Seven sequential checks:
exists → `status == "paid"` → `delivered_at` is set → inside the 14-day
`RETURN_WINDOW` of `delivered_at` (not `created_at` — the [[P1-06]]
distinction `view/OrderHistory.tsx`'s own section discusses) → no
existing `return_status` → no item with `size__iexact="CUSTOM SIZE"` →
no item with `custom_length_selected=True` → no item whose
`return_policy` is `FINAL_SALE` → no item whose `return_policy` is
`NON_RETURNABLE_HYGIENE`. Each failure returns a distinct, customer-
readable message (`view/OrderHistory.tsx`'s `requestReturn` surfaces
these directly via `error.response.data.detail`). No email is sent from
this view at all — the customer's own successful response is
confirmation enough; see walkthrough 3 in How the pieces fit.

**What it talks to:** `orders/emails.py` (`send_order_canceled_email`,
`send_refund_initiated_email`), `stripe.Refund.create`, `.serializers`
(`OrderReadSerializer`), `.models` (`Order`, `OrderItem`). Frontend:
`view/OrderHistory.tsx` (`MyOrdersAPIView` via `GET /orders/my/`,
`CancelOrderAPIView` via `POST /orders/{id}/cancel/`,
`RequestReturnAPIView` via `POST /orders/{id}/return/`), `view/Order.tsx`
(`MyOrdersAPIView` only, for the first-order promo check).

**Watch out for:** `CancelOrderAPIView`'s eligibility checks and
`RequestReturnAPIView`'s are **independently written out**, not shared
through a common helper, despite overlapping on "must be `status ==
"paid"`" and "must not already have a `return_status`" — a future rule
change to either shared condition would need to be applied in both
places by hand, the same "logic duplicated instead of extracted"
pattern this guide has flagged elsewhere (e.g. the price-composition
logic independently implemented in `Cart.tsx`/`Order.tsx`/
`ProductDetails.tsx`, per that section above).

**Interview questions:**
- *Q: Why must `stripe.Refund.create` run with no Django transaction
  open, when it would be simpler to keep the whole cancel operation
  inside one `transaction.atomic()` block?* — Two separate reasons,
  both real: first, `select_for_update()` in phase 1 takes a row-level
  lock that would otherwise be held for however long the network round-
  trip to Stripe takes — anywhere from tens of milliseconds to several
  seconds under load or a slow Stripe response — serializing every
  other request touching that same order (a concurrent read, a webhook
  processing a refund event for it) behind that call for no reason
  related to the database itself. Second, a network call inside a
  transaction that later rolls back for an unrelated reason (a
  post-Stripe-call `save()` failing, a dropped DB connection) would mean
  Stripe already processed the refund while the database silently
  behaves as if it never happened — the worst version of this bug,
  since it's invisible until someone manually reconciles against Stripe.
  Splitting into three phases means the row is only ever locked for the
  two short, purely-local phases, and phase 2's Stripe call — whatever
  it does — can never be undone by a Django rollback, because there's no
  open transaction left for anything to roll back.
- *Q: If two cancel requests for the same order arrive at nearly the
  same instant, what actually stops both from calling
  `stripe.Refund.create`?* — Not the row lock — by the time either
  request reaches phase 2, its own phase-1 transaction (and the lock
  with it) has already been released. What stops the second request is
  the `refund_status == "initiating"` check *inside* phase 1: the first
  request's phase 1 sets that marker and commits before the second
  request's phase 1 even starts (phase 1's `select_for_update()` makes
  the two phase-1 transactions themselves mutually exclusive, however
  briefly), so the second request's own phase-1 checks see
  `refund_status == "initiating"` already set and return 400 before ever
  reaching phase 2 at all. The marker, not a lock held across the
  network call, is what does the actual work here — matching this
  guide's Glossary entry on the three-phase refund pattern.
- **Harder follow-up:** *Q: Phase 2's Stripe failure clears the
  `"initiating"` marker; phase 3's failure deliberately does not. Why is
  that asymmetry correct rather than a bug?* — The two phases fail at
  fundamentally different points relative to whether money actually
  moved. A phase-2 failure means `stripe.Refund.create` itself didn't
  succeed — nothing happened at Stripe, so clearing the marker back to
  "no refund in progress" accurately reflects reality and lets the
  customer retry cleanly. A phase-3 failure happens **after** Stripe has
  already returned a successful refund response — the money is already
  moving (or moved) at Stripe's end regardless of what Django does next;
  clearing the marker here would make the order look exactly like
  "nothing was ever attempted," silently hiding a refund that genuinely
  happened. Leaving `refund_status: "initiating"` stuck is the version
  of this failure that stays *discoverable* — someone reconciling orders
  against the Stripe dashboard would immediately notice an order stuck
  in that state and know to go look at what Stripe actually shows for
  it, rather than the order looking identical to one nothing ever
  happened to.

### `orders/views_stripe.py`

**What it is:** the file the Stripe integration actually lives in —
1,231 lines, the largest file in this app by a wide margin, and the only
place an `Order` row is ever created. Two `@api_view` functions
(`create_checkout_session`, `stripe_webhook`) plus roughly a dozen module-
level helpers, several of which exist purely to keep the webhook handler
itself from becoming unreadable.

**Money-handling helpers, as a group:** `_safe_decimal(value)` wraps
`Decimal(str(value or "0"))` in a broad `except (TypeError, ValueError,
ArithmeticError)` returning `Decimal("0")` — used everywhere a price
comes from a place that could plausibly be malformed (a product's price
field, a cart item's surcharge). `_money_to_cents`/`_cents_to_money` are
each other's inverse, converting between this codebase's `Decimal`
dollar amounts and the integer-cent amounts Stripe's API requires
everywhere (`unit_amount` on a line item, `amount_total`/
`amount_subtotal`/`amount_discount`/`amount_tax` read back off a
session) — `_money_to_cents` uses `Decimal.quantize(Decimal("1"),
rounding=ROUND_HALF_UP)` specifically so a price like `$19.995` (which
shouldn't exist in this catalog, but could in principle from a
discount calculation) rounds to the nearest cent deterministically
rather than however Python's default float rounding would land, and
never touches a `float` at any point in the conversion — the classic
"don't use binary floating point for money" rule, followed here by
routing every dollar amount through `Decimal` end to end.

**`_item_unit_price(item)`**: base product price, plus
`custom_length_surcharge` **only if** `item.custom_length_selected` is
true — this is the backend's own copy of the same price-composition
logic `Cart.tsx`'s `getServerUnitPrice`, `Order.tsx`'s inline
`cartLines` calculation, and `ProductDetails.tsx`'s `displayPrice` each
implement independently on the frontend (flagged in `Cart.tsx`'s own
Watch out for, above) — here it's the one place that actually
determines what Stripe is told to charge and what gets frozen onto
`OrderItem.unit_price`, so a frontend/backend disagreement about this
formula would show up as "the price I saw on `/cart` doesn't match what
Stripe charged me," not merely a display bug.

**`_build_cart_signature(items)`**: builds a stable fingerprint of a
cart's contents at the moment `create_checkout_session` runs, so the
webhook can later detect if the cart changed between session creation
and payment completion. For each item, joins eleven fields — `
product_size_id`, `quantity`, all seven custom-measurement strings,
`custom_length_selected`, `custom_length_cm`, `custom_length_surcharge`
— with `|`, then joins every item's string with `||` **after sorting
the list of per-item strings** (so the signature doesn't depend on
which order the cart's rows happen to come back from the database in),
and SHA-256-hashes the result, truncated to 24 hex characters.
Deliberately **does not include price** — price is separately re-derived
from `_item_unit_price` at both session-creation and webhook time using
the exact same function, so it can't drift independently of the fields
the signature actually covers; the signature's job is narrower: "is this
still the same set of items, sizes, quantities, and customizations," not
"is the total the same."

**`create_checkout_session`** (`IsAuthenticated`, no explicit throttle —
see `orders/throttles.py`'s Watch out for above): fetches the user's
`Cart`, 400s if empty. Requires `policy_accepted is True` in the request
body (not merely truthy — an explicit boolean check), and separately
requires `custom_size_final_sale_acknowledged is True` **only if**
`_cart_has_custom_size`/`_cart_has_custom_length` finds any qualifying
line — matching `view/Order.tsx`'s two-checkbox consent UI exactly.
Builds one Stripe line item per cart line: a best-effort **pre-check**
against `product_size.quantity < item.quantity` (400s immediately with
the specific product/size name if short — see this section's Interview
questions for why this doesn't make the webhook's own re-check
redundant), the first product image by `sort_order` as `images`, and a
`price_data.product_data.metadata` block carrying `product_size_id`/
`custom_length_selected`/`custom_length_cm`/`custom_length_surcharge` —
metadata that, notably, **the webhook never reads back off the line
items at all**; the webhook re-derives everything it needs from the
live `CartItem` rows via `cart_id`, not from anything embedded in the
Stripe session's line items. Session-level `metadata` (distinct from
each line item's own) carries `user_id`, `cart_id`, `cart_sig`
(the signature above), `is_first_order`/`welcome_code` (computed from
`_user_has_paid_order`, the same "has this user ever paid" question
`Order.tsx`'s own `isFirstOrder` check answers independently against
`/orders/my/`), and the policy-consent flags. `success_url`/`cancel_url`
are built from `settings.FRONTEND_URL` directly — the [[P1-16 (part 2)]]
fix removed a hardcoded-wrong-domain `getattr(..., "https://www.
tresseknitting.com")` fallback that was already dead code, since
`FRONTEND_URL` has no default in `settings.py` and Django won't start
without it.

**`stripe_webhook`** (`csrf_exempt`, `AllowAny`) — **why those two
decorators together, specifically:** this endpoint is never called by a
logged-in browser session at all; it's called server-to-server by
Stripe, which has no Django session or CSRF cookie to present and can't
authenticate as any of this app's users — `AllowAny` isn't a security
hole here because the real gate is what happens next.

- **Signature verification is the actual authentication for this
  endpoint**, and it's the very first thing that happens:
  `stripe.Webhook.construct_event(payload, sig_header,
  settings.STRIPE_WEBHOOK_SECRET)` — this checks that the raw request
  body was signed with the secret only Stripe and this app's settings
  know, using the `Stripe-Signature` header (read via
  `request.META.get("HTTP_STRIPE_SIGNATURE")`, not any custom scheme).
  Any failure — a missing/malformed header, a body that doesn't match
  its signature, a wrong secret — is caught by a bare `except Exception`
  and answered with `400`, logged only as `stripe_webhook_invalid_signature`
  (no further detail logged, deliberately, since a signature-verification
  failure is exactly the kind of thing an attacker probing the endpoint
  would also trigger, and the response gives them nothing to learn from).
  If `STRIPE_WEBHOOK_SECRET` itself isn't configured at all, the view
  short-circuits with `500` **before** even attempting verification —
  refusing to run in a mode where anyone could post an unsigned event
  and have it accepted.
- **Refund events** (`refund.created`/`refund.updated`/`refund.failed`)
  are handled first and separately, entirely by `_sync_refund_event` —
  covered under this section's own entry below — then the webhook
  returns immediately; nothing past this point in the function applies
  to a refund event at all.
- **Every other event type except `checkout.session.completed`** is
  acknowledged with `200`/`{"ok": true}` and otherwise ignored — Stripe
  sends many event types this app has no reason to act on, and silently
  200-ing the ones it doesn't handle is what stops Stripe from retrying
  them forever.
- **The `checkout.session.completed` branches**, in the order they're
  checked, each following the identical shape (log an `error`, compute a
  best-effort `amount`/`customer_email` via `_session_amount_and_email`
  straight off the raw session dict — since at this point there may be
  no `Order` and no parsed amounts to reference yet — call
  `send_checkout_webhook_alert` with a reason string, return `200`):
  1. **`missing_metadata`** — no `user_id`, `cart_id`, or
     `payment_intent` at all in the session; nothing downstream could
     possibly succeed.
  2. **`user_not_found`** — `user_id` doesn't resolve to a real `User`.
  3. **`cart_not_found`** — `cart_id` doesn't resolve to a `Cart` owned
     by that user.
  4. **`empty_cart`** — the cart has no `CartItem` rows. **This is the
     one branch with an extra check before alerting**: a legitimate
     retry delivery of an *already-processed* event lands here too,
     since the original processing already deleted the cart's items —
     `already_processed = Order.objects.filter(user=, stripe_payment_intent=
     ).exists()` gates the alert, so a duplicate delivery of a
     successfully-processed checkout stays silent instead of paging
     someone for nothing (this is the [[P0-08]] fix's own fix-within-a-
     fix — the empty-cart branch originally ran *before* any idempotency
     check at all, so every duplicate delivery of a normal successful
     checkout used to alert).
  5. **`policy_consent_missing`** — `policy_accepted` false or
     `policy_version` blank in the session metadata.
  6. **`custom_ack_missing`** — the cart has a custom-size or
     custom-length line but `custom_size_final_sale_acknowledged` is
     false.
  7. **`cart_signature_mismatch`** — `_build_cart_signature` over the
     *current* cart items no longer matches `cart_sig` from the
     session's metadata; the cart changed between checkout-session
     creation and payment completion.
  8. **(after the idempotency check below) `stock_insufficient`** — the
     one branch that also refunds and emails the customer; see below.

  Between branches 7 and 8 sits the **idempotency check** proper:
  `Order.objects.filter(user=, stripe_payment_intent=).first()` — if an
  `Order` for this exact payment intent already exists, return `200`
  immediately with **no alert at all**, since this is the expected,
  routine case of Stripe redelivering an event this endpoint already
  handled successfully (Stripe's delivery model is at-least-once, not
  exactly-once — a webhook endpoint that isn't idempotent *will*
  eventually create duplicate orders, not just theoretically).
- **Order creation**, once every check above has passed, happens inside
  one `transaction.atomic()`: `select_for_update()`s each cart item's
  `ProductSize` and re-checks `quantity < cart_item.quantity` **again**
  — this is the check that actually matters, since arbitrary real time
  (filling in a card number, an address, 3-D Secure) can pass between
  `create_checkout_session`'s own best-effort pre-check and payment
  actually completing, during which someone else could have bought the
  last unit. If any line is short, a `stock_shortage` dict is set and
  the locking loop `break`s — **not `return`s** — so the `with
  transaction.atomic()` block itself still exits normally, with nothing
  written (see this section's own entry on why that distinction
  matters). If stock holds, the block creates the `Order`, one
  `OrderItem` per cart line (copying `unit_price` from `_item_unit_price`,
  `return_policy` from the *product's current* `return_policy` — another
  purchase-time snapshot, matching `OrderItem.return_policy`'s own entry
  in `models.py` above), decrements each `ProductSize.quantity` (the
  exact write `products/signals.py`'s back-in-stock guard has to
  distinguish from a genuine restock — see [[P0-02]] and walkthrough 4),
  deletes the cart's `CartItem` rows, and schedules
  `send_order_confirmation_email` via `transaction.on_commit` — a
  closure capturing `order.id` (not the in-memory `order` object itself)
  that **re-fetches** the order fresh from the database once the
  transaction has actually committed, rather than trusting the
  in-transaction instance, so the email is built from what's actually
  durable.
- **The stock-shortage refund, deliberately outside the transaction
  entirely:** `stock_shortage` is checked **after** the `try/except`
  wrapping the whole `transaction.atomic()` block has already exited —
  by the time `_refund_stock_sold_out_checkout(payment_intent_id,
  session_id, email, total_amount)` runs, there is no open transaction
  anywhere in this call stack. That function itself calls
  `stripe.Refund.create(idempotency_key=f"stock_sold_out_refund_
  {payment_intent_id}")` in its own `try/except` (a `StripeError` or any
  other exception is logged and swallowed, and the function simply
  `return`s — no email is attempted if the refund call itself failed),
  and only on a successful refund does it call
  `send_checkout_stock_sold_out_email` in a second, separately-guarded
  `try/except`. This is the same "network call, no open transaction"
  discipline as `CancelOrderAPIView`'s phase 2 (`views.py`, above) — the
  one difference being there's no phase-1/phase-3 split needed here at
  all, since nothing was ever written to the database for this order in
  the first place; there's nothing to mark `"initiating"` and nothing to
  roll back.

**`_sync_refund_event(refund)`**: handles `refund.created`/`.updated`/
`.failed` webhook deliveries — a **separate** event stream from
`checkout.session.completed`, arriving whenever a refund's status
changes at Stripe's end, including asynchronously after
`issue_stripe_refund` (`admin.py`) or `CancelOrderAPIView` (`views.py`)
already recorded an initial (possibly `"pending"`) status. Looks the
order up by `stripe_refund_id` (not payment intent) under its own
`transaction.atomic()` + `select_for_update()`, updates `refund_status`
to whatever the event reports, and — **only** if the new status is
`"succeeded"` **and** the order's `return_status` is currently
`"refund_pending"` — flips it to `"refunded"` and stamps
`return_refunded_at`. An order not found by that refund id logs a
warning and returns quietly (not every refund Stripe processes
necessarily belongs to this store, and a webhook must never error on an
event it simply doesn't recognize). Any other exception during the
update is logged and **re-raised**, unlike every other failure path in
this file, which logs and either continues or returns `200` — the
caller, `stripe_webhook`'s own `try: _sync_refund_event(refund) except
Exception:` around this call, catches that re-raise immediately and
turns it into an explicit `500`. This is the **only** branch of the
entire webhook that ever responds with anything other than `200` for an
event it otherwise understood how to handle — and a `500` is
deliberate here, not an oversight: it's the one signal that tells
Stripe "this didn't work, please retry delivery," for the one event
type (a refund status change) where losing the update silently would
leave `refund_status`/`return_status` stuck out of sync with what
actually happened at Stripe, with no other mechanism to notice.

**What it talks to:** `products/models.py` (`Cart`, `CartItem`),
`.emails` (`send_order_confirmation_email`,
`send_checkout_webhook_alert`, `send_checkout_stock_sold_out_email`),
`.models` (`Order`, `OrderItem`), the Stripe SDK throughout
(`checkout.Session.create`, `Webhook.construct_event`,
`PaymentIntent.retrieve`, `Refund.create`). Frontend: `view/Order.tsx`
(`create_checkout_session` via `POST
/orders/create-checkout-session/`), and — indirectly, since Stripe calls
this server-to-server, never the browser — the redirect this endpoint's
sibling produces is what lands the customer on `view/OrderSuccess.tsx`.
`view/Cart.tsx`'s cart state is what `create_checkout_session` reads via
`Cart`/`CartItem`, one hop removed.

**Watch out for:**
- **`stripe.checkout.Session.create` itself has no `idempotency_key`** —
  every `stripe.Refund.create` call in this codebase (here and in
  `views.py`/`admin.py`) passes one, but session creation doesn't. A
  network retry, a double-click past whatever frontend debouncing exists,
  or a legitimate customer hitting back and re-submitting checkout each
  creates a **separate** Stripe Checkout Session with its own payment
  intent — not a risk of a duplicate `Order` row (the webhook's own
  `stripe_payment_intent` idempotency check and the field's `unique=True`
  constraint handle that), but a real risk of two live, independently
  payable sessions existing for the same cart at once, whose interaction
  with `create_checkout_session`'s own missing throttle (see
  `orders/throttles.py` above) compounds the exposure rather than
  mitigating it.
- **`create_checkout_session`'s stock pre-check is advisory, not
  authoritative** — it exists purely so an obviously-out-of-stock add
  gets rejected before the customer is sent to Stripe's page at all, not
  because it prevents the race the webhook's own `select_for_update()`
  re-check actually guards against; see this section's Interview
  questions for the concrete timeline where the pre-check passes and the
  webhook's re-check is the only thing standing between two customers
  and the same last unit.
- `_extract_card_details_from_payment_intent` makes a **second** live
  call to Stripe (`PaymentIntent.retrieve`) from inside the same request
  that's already processing a webhook delivery, purely to populate
  `card_brand`/`card_last4` for display — any failure here (a timeout, a
  transient Stripe error) is caught and logged, falling back to empty
  strings rather than failing order creation over cosmetic card-display
  data, but it does mean a slow or flaky Stripe API can make the webhook
  handler itself slower or occasionally fail to populate these two
  fields even on an otherwise fully successful order.

**Interview questions:**
- *Q: Walk through exactly what stops Stripe's at-least-once webhook
  delivery from ever creating two `Order` rows for one payment.* — Two
  layers, deliberately redundant: the application-level check
  (`Order.objects.filter(user=, stripe_payment_intent=).first()`, run
  before any write) handles the overwhelmingly common case of a
  straightforward duplicate delivery cheaply and returns `200` with no
  alert. The **real** guarantee is `Order.stripe_payment_intent`'s
  `unique=True` constraint (added in migration `0008`) — if two
  deliveries for the same event somehow raced past the application
  check at the same instant (a genuine TOCTOU window, since the check
  and the later `Order.objects.create()` aren't in the same lock), the
  second `create()` call would raise `IntegrityError` inside the
  `transaction.atomic()` block, get caught by the surrounding
  `except Exception`, log `checkout_order_creation_failed`, and return
  `500` — which tells Stripe to retry. On that retry, the application-
  level check now finds the first delivery's order and returns a clean
  `200`. The database constraint is what actually makes duplication
  impossible; the application check is what makes the common case cheap
  and silent instead of an error-then-retry round trip every time.
- *Q: The webhook's stock-shortage branch breaks out of the locking loop
  instead of returning from inside `transaction.atomic()`. Why does that
  specific detail matter?* — Because the refund that follows
  (`_refund_stock_sold_out_checkout`, calling `stripe.Refund.create`)
  must run with **no transaction open at all** — the same "don't hold a
  lock or a transaction open across a network call" rule
  `CancelOrderAPIView`'s three-phase pattern exists for. A bare `return`
  from inside the `with transaction.atomic():` block would still exit
  the block cleanly in this specific case (nothing was written, so
  there's nothing to roll back either way) — but writing it as `break`
  the loop and letting the `with` block's own natural exit close the
  transaction, then checking `stock_shortage is not None` **after** the
  `try/except` around the whole block, makes the "the transaction is
  fully closed by the time we call Stripe" property visible and
  structural in the code, not just true by accident of what happens to
  be written on either side of a `return`.
- **Harder follow-up:** *Q: Trace the exact interaction between
  `create_checkout_session`'s stock pre-check and the webhook's
  `select_for_update()` re-check for two customers, A and B, both trying
  to buy the last unit of the same product/size, where A completes
  Stripe's payment form in eight seconds and B takes four minutes on the
  same page.* — Both A and B's checkout-session creation calls can
  legitimately pass the pre-check (`product_size.quantity < 
  item.quantity`) if they happen close enough together that neither has
  paid yet — the pre-check only compares against whatever `quantity`
  currently reads at that instant, with no lock, so it says nothing
  about what happens between then and either customer actually paying.
  A pays first; A's webhook delivery takes the `select_for_update()`
  lock, sees stock still available, creates the order, and decrements
  `quantity` to zero, releasing the lock when its transaction commits.
  When B eventually pays and B's webhook delivery arrives, it takes the
  same `select_for_update()` lock (waiting behind A's if the two
  webhooks ever briefly overlapped, though four minutes apart they
  almost certainly won't), sees `quantity` now at zero, and takes the
  `stock_insufficient` branch — no order for B, an ops alert, an
  automatic Stripe refund, and `send_checkout_stock_sold_out_email`
  telling B their payment was refunded because the item sold out. B's
  own `create_checkout_session` pre-check passing four minutes earlier
  never promised B anything — it was only ever a same-instant read, and
  the webhook's lock-and-recheck is the actual, and only, authority on
  whether stock exists at the moment it's about to be permanently
  decremented.

### `orders/tests.py`

1,628 lines — the largest test file in either backend app section of
this guide, and, per [[P1-19]], largely written to specifically pin down
the money-moving paths that had no coverage at all before that pass.
`stripe.Refund.create`/`stripe.Webhook.construct_event` are mocked at
every call site across the file — **no test in this suite calls real
Stripe**, confirmed structurally by every Stripe-touching test carrying
its own `@patch`, and reinforced at the settings layer by the "Test
settings isolation" fix (`docs/fixes-2026-09.md`), which guarantees
`STRIPE_SECRET_KEY` is a dummy value in the test environment regardless.

**Test classes exist because a bug was found, not just for coverage, in
two identifiable places:**
- **[[P0-09]]'s proof tests** — `test_cancel_stays_discoverable_when_
  recording_the_result_fails` and its `issue_stripe_refund` counterpart
  patch `Order.save` itself with a function that raises only when the
  `update_fields` passed include `"status"` (phase 3's save, not phase
  1's "initiating"-only save), so the test can assert precisely that a
  refund already issued at Stripe (the mock `stripe.Refund.create` was
  genuinely called) leaves `refund_status: "initiating"` rather than
  reverting — the exact "discoverable, not silently lost" property
  [[P0-09]]'s fix exists for. **`test_cancel_calls_stripe_outside_the_
  views_own_atomic_block`** (and its admin-action counterpart) go
  further than asserting behavior: they read
  `connection.savepoint_ids` — Django's actual live transaction-nesting
  depth — both before the request and from *inside* the mocked
  `stripe.Refund.create` call itself, and assert the two depths are
  identical, which is a structural proof that Stripe was called at the
  same nesting level as ordinary request handling, not one level deeper
  inside phase 1's `transaction.atomic()`. This is a meaningfully
  stronger claim than "the response looked right" — it's a test that
  would fail if a future refactor accidentally nested the Stripe call
  back inside a transaction, even if every other assertion in the test
  still passed.
- **[[P0-08]]'s `CheckoutWebhookAlertTestCase`/
  `CheckoutWebhookAlertHelperTestCase`** — one test per alert branch
  (all eight), plus the duplicate-delivery-stays-silent case for
  `empty_cart` specifically, plus dedicated tests proving the alert
  helper's two internal steps (Sentry, support email) genuinely fail
  independently of each other (a failing Sentry call still lets the
  email attempt happen; a failing email send doesn't retroactively
  un-call Sentry; no `SUPPORT_EMAIL` configured skips the email but
  still calls Sentry) — see `orders/emails.py`'s Harder follow-up above
  for exactly the gap these tests are drawing a hard edge around.

**[[P1-19]] itself is the odd one out — 32 new tests, and the result
section says so directly: "All 32 new tests passed on the first run
against the current code... no bug was found and none was fixed."** This
is the suite's `MyOrdersAPITestCase`, `CancelOrderAPITestCase` (10
tests — every eligibility check in `CancelOrderAPIView` individually,
plus the Stripe-error and missing-refund-id paths), `RequestReturnAPITestCase`
(12 tests — every one of `RequestReturnAPIView`'s seven checks), and
`OrderAdminReturnActionsTestCase` (7 tests — the return/refund admin
actions, including proving `issue_stripe_refund` calls Stripe **only**
for orders that actually qualify, out of a mixed batch). Its own "not
changed" note — that `approve_return`/`issue_stripe_refund` don't
recheck `custom_length_selected` — is stated as an observed gap, left
deliberately untested and unfixed, rather than silently glossed over
(see `orders/admin.py`'s own entry above for the reachability caveat
that makes it low-risk today).

**Other groups worth naming:** `OrderPublicIdTestCase`/
`OrderSaveLogicTestCase`/`OrderPaymentIntentTestCase` exercise
`models.py`'s `save()` logic directly against the ORM, no HTTP involved
— including `test_duplicate_payment_intent_raises`, which asserts
`IntegrityError` on a second `Order.objects.create()` with a repeated
`stripe_payment_intent`, the most direct possible proof of the unique
constraint this guide's `views_stripe.py` Interview questions lean on.
`CheckoutSessionCompletedTestCase` covers the happy path end to end (an
order is created, `OrderItem` rows match, stock decrements, the cart
empties) plus `test_duplicate_webhook_is_idempotent` (posts the identical
event twice, asserts exactly one `Order` exists) and
`test_insufficient_stock_does_not_create_order` (asserts no order, stock
unchanged, and the refund mock called exactly once).
`OrderAdminShippingActionsTestCase` covers [[P1-07]]'s two actions —
happy path (email sent, timestamp set) and skip path (ineligible order
untouched, no email) for both.

**Interview questions:**
- *Q: `test_cancel_calls_stripe_outside_the_views_own_atomic_block`
  asserts on `connection.savepoint_ids` rather than, say, mocking
  `transaction.atomic` and asserting it wasn't entered around the Stripe
  call. Why is reading the real savepoint depth the stronger test?* —
  Mocking `transaction.atomic` (or patching it to a no-op) would prove
  the test's *own* understanding of the code's structure, not the code's
  actual behavior — a refactor could change how transactions are nested
  without the mock ever noticing, since the mock only records that it
  was called, not what real transactional state existed at the moment
  of the Stripe call. Reading `connection.savepoint_ids` — Django's own
  live bookkeeping of transaction nesting — inside the mocked Stripe
  call means the assertion is grounded in what the database connection
  actually believes is true at that exact moment, which is the property
  that matters (no open transaction, no held lock), not a proxy for it.
- *Q: Every Stripe-touching test in this file mocks
  `stripe.Refund.create`/`stripe.Webhook.construct_event` directly.
  What's the one thing this test suite, taken as a whole, cannot prove
  about the checkout/refund flow no matter how thorough it gets?* — That
  the *real* Stripe API actually behaves the way these mocks assume it
  does — the shape of a refund response, what `construct_event` actually
  validates, what error types a live `StripeError` can be. A test suite
  built entirely on mocks proves this codebase's own logic is internally
  consistent with its assumptions about Stripe's contract, not that
  those assumptions are still correct against Stripe's real API (a
  library version bump, an API version change) — which is exactly the
  gap `docs/fixes-2026-09.md`'s "Test settings isolation" entry is
  implicitly guarding against from the other direction: making sure a
  *misconfigured* test environment can't accidentally call the real API
  either, rather than trying to prove the mocked one still matches it.
- **Harder follow-up:** *Q: [[P1-19]]'s 32 tests all passed against
  already-correct code. Was writing them still worth doing, given no bug
  was found?* — Yes, and the entry says so explicitly rather than
  treating a clean result as a non-event: before [[P1-19]], the code
  paths that decide who gets money back (`CancelOrderAPIView`,
  `RequestReturnAPIView`, and four admin actions calling
  `stripe.Refund.create`) had **zero** dedicated tests — any future
  change to any eligibility check, any window calculation, any status
  transition in those files could regress silently, exactly the
  [[P0-01]]-shaped risk this guide's own "Testing strategy" question (in
  Questions by topic) names directly: a green suite proves nothing about
  code the suite never actually exercises. [[P1-19]] converted "we
  believe this is correct" into "this is asserted, and will fail loudly
  the moment it stops being true" — the value delivered is the coverage
  existing at all, independent of whether this particular pass happened
  to also find a bug.

---

## How the pieces fit

Four walkthroughs, each naming the files involved in order, across both
codebases. The first is the everyday path; the other three are what
happens after the sale — a cancellation, a return, and a restock —
which between them touch almost every file in the three Backend —
accounts/products/orders sections above.

### 1. A guest adds an item, logs in, and pays — through to the webhook and the confirmation email

1. **Guest adds an item.** On `/product/:id`
   (`view/ProductDetails.tsx`), picking a size and clicking "Add to
   cart" calls `addProductToCart`. Since `isAuthenticated()`
   (`types/token.ts`) is false, it dispatches `addToCart` from
   `utils/cartSlice.ts` — a synchronous Redux action, no network call.
   The reducer builds a new `GuestCartItem` (spreading the full
   `Product` object, generating a fresh `lineId` via
   `crypto.randomUUID()`) or increments an existing line if one already
   matches on product + size + measurements + custom-length, then
   `saveToLS` persists the whole guest cart to
   `localStorage["guest_cart"]` immediately.
2. **Guest opens the cart.** On `/cart` (`view/Cart.tsx`), `isAuthed` is
   false, so `usingServer` is false and the page reads
   `selectGuestCartItems` from `utils/cartSlice.ts`'s slice directly —
   no request happens. Pricing (`getGuestUnitPrice`) and the
   measurements-completeness check both read straight from the same
   guest-cart Redux state.
3. **Guest logs in.** On `/authorization` (`components/Authorization.tsx`),
   submitting the form calls `loginUser` (`api/auth.ts`) → `POST
   /accounts/token/` (`CustomTokenObtainPairView`, which uses
   `CustomTokenObtainPairSerializer` to authenticate by email instead of
   SimpleJWT's default username field — `tresse_backend/accounts/
   serializers.py`). On success, the component dispatches
   `setCredentials({token: access, user, refresh: refresh ?? undefined})`
   to `utils/authSlice.ts`, which persists both tokens via
   `types/token.ts` (`setAccessToken`, `setRefreshToken`) and writes the
   user object to `localStorage["user"]` itself. The component then
   awaits `dispatch(mergeGuestCart())` and `dispatch(fetchCart())`
   (`store/serverCartSlice.ts`), each in its own non-blocking
   `try/catch`.
4. **The merge.** `mergeGuestCart` (`store/serverCartSlice.ts`) reads the
   guest cart's items via `selectGuestCartItems`, and for each one calls
   the private `postCartItem` helper → `POST /products/cart/items/`
   (`CartItemAPIView.post`, `tresse_backend/products/views.py`) — sending
   `product_size_id`, quantity, and the measurement/custom-length-selected
   fields (never the read-only `custom_length_cm`/`custom_length_surcharge`
   values, which the backend computes itself from the product). As each
   line's request resolves, `mergeGuestCart` immediately dispatches
   `removeFromCart({lineId})` against `utils/cartSlice.ts` to drop that
   one line from the guest cart — so a partial failure leaves only the
   failed lines behind for the next login's merge attempt, rather than
   re-posting everything.
5. **The refresh.** `fetchCart()` then calls `GET /products/cart/`
   (`CartAPIView.get`), which `get_or_create`s the user's `Cart` and
   serializes it with `CartSerializer`. The response replaces
   `state.serverCart.cart` wholesale.
6. **Navigating to checkout.** Back on `/cart`, `isAuthed` is now true and
   `usingServer` is true, so the page switches to rendering
   `state.serverCart.cart.items` instead of the (now largely empty) guest
   cart. Clicking "Pay" (`onPay`) navigates to `/order`
   (`view/Order.tsx`, behind `PrivateRoute`, wrapped by `App.tsx`'s
   `OrderRouteWithStripe`, which lazy-loads `@stripe/stripe-js` before
   rendering `Order`).
7. **Checkout.** `Order.tsx` fetches the server cart again on mount,
   separately checks `GET /orders/my/` (`MyOrdersAPIView`) to decide
   whether to show the `TRESSE15` first-order promo (the same code the
   `welcome.txt` email hardcodes — see Backend — email templates above),
   and requires the Return Policy consent checkbox (plus a final-sale
   checkbox if any line is custom-sized/custom-length) before
   `handleCheckout` can run. Confirming calls `POST
   /orders/create-checkout-session/` (`create_checkout_session`,
   `tresse_backend/orders/views_stripe.py`), sending
   `{policy_accepted, custom_size_final_sale_acknowledged}`. The
   response's `url` is handed to `window.location.assign(...)` — a full
   page navigation off the app entirely, to Stripe's own hosted checkout
   page.
8. **Payment and the webhook.** The customer enters payment details on
   Stripe's page, not this app's. Stripe processes the charge and — once
   confirmed — calls the backend's webhook endpoint directly
   (`POST /orders/webhook/`, `stripe_webhook` in `views_stripe.py`) with
   a `checkout.session.completed` event. **This is the only place an
   `Order` row is actually created** — nothing in the frontend ever
   creates one. Before creating anything, the handler: checks a cart
   signature against what was recorded at checkout-session creation
   (mismatch → alert only, `send_checkout_webhook_alert`, no order); does
   an idempotency check (`Order.objects.filter(user=, stripe_payment_intent=)`)
   so a duplicate webhook delivery for an already-processed payment is a
   silent no-op; and, inside `transaction.atomic()`, `select_for_update()`s
   each `ProductSize` line to re-validate stock is still available *at
   this moment*, not merely at add-to-cart time. If stock is short, the
   transaction is abandoned with nothing written, and — now outside any
   open transaction — `_refund_stock_sold_out_checkout()` issues a full
   Stripe refund and `send_checkout_stock_sold_out_email` tells the
   customer (see [[P0-08]]); this is the only branch of the eight the
   webhook can fail on that both refunds the customer automatically
   *and* emails them directly, since it's the only one where the
   customer's money was captured for an order that will now never exist.
9. **The confirmation email.** If stock holds, the webhook creates the
   `Order` and each `OrderItem`, decrements `ProductSize.quantity` for
   each line bought (the exact write that `products/signals.py`'s
   restock guard, walkthrough 4 below, has to be able to tell apart from
   a genuine restock), and deletes the now-checked-out `CartItem` rows.
   Only *after* that transaction commits (`transaction.on_commit`) does
   it re-fetch the fresh `Order` with its items and call
   `send_order_confirmation_email` (`orders/emails.py`) — rendering
   `templates/emails/orders/order_confirmation.txt` with the order and
   its items. Deferring to `on_commit` means a failure partway through
   order creation can never result in a confirmation email for an order
   that got rolled back.
10. **Landing back in the app.** Stripe's `success_url` (built from
    `settings.FRONTEND_URL` server-side) redirects the browser to
    `/order/success?session_id=...&order=...` — a **public** route (no
    `PrivateRoute`), since this redirect shouldn't require a live session
    in that specific browser tab. `view/OrderSuccess.tsx` reads the query
    params, persists the order id to `localStorage` for a page refresh's
    sake, fires a deduplicated `Purchase` pixel event
    (`utils/tiktokPixel.ts`), and dispatches `clearGuestCart()` +
    `clearServerCart()` + `fetchCart()` to reset cart state now that the
    order has been placed. Note that this redirect and the webhook are
    two independent things Stripe does — the confirmation email in step
    9 does not wait for, and has no dependency on, the customer's browser
    ever reaching this page at all.

### 2. An order is cancelled and refunded

1. The customer opens `/orders` (`view/OrderHistory.tsx`, behind
   `PrivateRoute`), which calls `GET /orders/my/` (`MyOrdersAPIView`) and
   shows a Cancel action for any order still within the 24-hour
   `CANCEL_WINDOW` of `created_at`.
2. Clicking it posts to `orders/views.py`'s `CancelOrderAPIView`, which
   runs in three phases specifically so the order row is never locked
   for the duration of a network round-trip to Stripe (see [[P0-09]] —
   this exact shape is discussed in depth under "Transaction boundaries"
   in Questions by topic below): **(1)** a short `transaction.atomic()`
   that `select_for_update()`s the order, runs every eligibility check
   (must be `status="paid"`, inside the cancel window, no existing
   return workflow, no existing refund, not already
   `refund_status="initiating"`), and — if all pass — marks
   `refund_status="initiating"` and commits; that marker alone is what
   stops a second concurrent cancel request for the same order from
   proceeding. **(2)** with no transaction open, calls
   `stripe.Refund.create(payment_intent=..., idempotency_key=f"cancel_order_{id}_{payment_intent}")`.
   **(3)** a fresh `transaction.atomic()` records the returned refund id
   and status, sets `order.status = "canceled"`, and — via
   `transaction.on_commit` — queues **both**
   `send_order_canceled_email` and `send_refund_initiated_email`
   (`orders/emails.py`, rendering `order_canceled.txt` and
   `refund_initiated.txt`).
3. If phase 2's Stripe call fails outright, a best-effort cleanup
   (`_clear_cancel_refund_initiating`) clears the `"initiating"` marker
   so the customer can retry; if phase 3 fails *after* Stripe already
   issued the refund, the marker is deliberately **left in place** rather
   than cleared, so the order stays visibly in an "initiating" state for
   someone to reconcile against Stripe by hand, instead of silently
   looking like no refund ever happened.
4. The customer sees both emails land — cancellation and refund
   initiated — for a self-service cancel.

### 3. A return is requested, approved, and refunded

1. Once `delivered_at` is set on the order (see walkthrough 1's absence
   of this step — it's set by an admin action, not by the checkout flow
   at all; see [[P1-07]]), `OrderHistory.tsx` shows a Return action for
   14 days (`RETURN_WINDOW`) from that timestamp, not from `created_at`.
2. Clicking it posts to `orders/views.py`'s `RequestReturnAPIView`, which
   — again inside a locking `transaction.atomic()` — refuses a final-sale
   item, a non-returnable-hygiene item, a custom-size item, or a
   custom-length item outright (each of `OrderItem.ReturnPolicy` and the
   two custom flags checked independently), then sets
   `order.return_status = "requested"`. **No email is sent at this
   step** — the customer's own action already confirmed it to them in
   the UI; nothing in `orders/emails.py` is called here.
3. **Approval and refund happen entirely in the Django admin**, not
   through any customer-facing endpoint — four sequential admin actions
   on `orders/admin.py`'s `OrderAdmin`, each guarding the previous
   state precisely: `approve_return` (`"requested"` → `"approved"`,
   re-checking the same non-returnable/custom-size rules a second time
   rather than trusting the original request check — see Questions by
   topic's note on this being **incomplete**, since it doesn't recheck
   `custom_length_selected`), `mark_return_received` (`"approved"` →
   `"received"`, once the physical item is back), and
   `issue_stripe_refund` (`"received"` → `"refunded"` or
   `"refund_pending"` depending on the returned Stripe refund status) —
   run through the identical three-phase
   lock/call-Stripe/record-with-`on_commit` pattern as
   `CancelOrderAPIView` above, down to reusing the same
   `_clear_return_refund_initiating` cleanup shape and a
   `return_refund_{id}_{payment_intent}` idempotency key.
4. **Watch out for:** `issue_stripe_refund` imports only
   `send_delivered_email`/`send_shipping_confirmation_email` at the top
   of `orders/admin.py` — it does **not** import or call
   `send_refund_initiated_email` or `send_order_canceled_email`.
   Confirmed directly against the file's imports: **a return refund
   issued through the admin sends the customer no email at all**, unlike
   a customer-initiated cancel (walkthrough 2), which always sends two.
   The only way a customer would learn a return refund actually happened
   is by checking their bank statement or logging back in to see
   `return_status: "refunded"` on `/orders`.
5. `reject_return` is the fourth action, available from either
   `"requested"` or `"approved"`, setting `return_status = "rejected"` —
   also silent, no email.

### 4. A back-in-stock notification, from the admin editing stock to the customer receiving the email

1. A signed-out or signed-in visitor on a sold-out size clicks "Notify
   me" (`components/ProductModal.tsx`'s `handleNotifyMe`), which calls
   `POST /products/{id}/subscribe_back_in_stock/`
   (`products/views.py`'s `subscribe_back_in_stock` action — `AllowAny`,
   using the authenticated user's email if logged in or a submitted
   `email` field otherwise) and creates a `StockSubscription` row
   (`product`, `email`, and `user` if authenticated;
   `unique_together = ("product", "email")` so re-clicking doesn't
   duplicate the row).
2. An admin edits stock on that product's size in the Django admin (or
   any other code path that saves a `ProductSize` with a positive
   quantity where it was previously zero) — `products/models.py`'s
   `ProductSize` overrides `__init__`/`from_db` to remember the quantity
   it started with (`self.__original_quantity`, name-mangled and
   therefore read/written under that mangled name even from the signal
   handler in a different module), specifically so the signal below can
   tell a genuine restock apart from every other kind of save.
3. Saving fires `products/signals.py`'s `notify_when_back_in_stock`
   (a `post_save` receiver on `ProductSize`, connected because
   `products/apps.py`'s `ready()` imports the signals module — this
   import is itself the fix for [[P0-01]], where the receiver was
   defined but never connected at all, and the zero-to-positive check
   is the fix for [[P0-02]], since without it *every* stock-decrementing
   purchase save, like walkthrough 1 step 9's `product_size.quantity -=
   cart_item.quantity`, would have matched `quantity > 0` and spammed
   every pending subscriber on a routine sale). If the transition is a
   genuine zero-to-positive restock, it looks up every
   `StockSubscription` for that product with `notified_at__isnull=True`.
4. For each one, `transaction.on_commit` (so a rolled-back stock edit
   sends nothing) calls `products/emails.py`'s
   `send_back_in_stock_email`, rendering
   `templates/emails/products/back_in_stock.txt` with the product name
   and a link back to `/product/{id}`, and — via `send_email_with_log`
   — writes an `EmailLog` row recording whether the send succeeded. Each
   subscription's `notified_at` is set immediately after its own email
   send succeeds, individually, inside the loop — one failed send (a
   bad address, a provider timeout) is logged and skipped without
   stopping the rest of the batch or being retried.
5. The customer's inbox is the only place this notification appears —
   there is no in-app notification center or badge; the entire feature
   is this one outbound email per subscriber per restock.

---

## Questions by topic

Cross-cutting questions that don't belong to any single file above —
each grounded in a specific mechanism named earlier in this guide, with
a file to go re-read if you want the full detail.

**Authentication and token rotation**
- *Q: Walk through what keeps a session alive past the access token's
  short lifetime.* — `SIMPLE_JWT` (`tresse_backend/tresse/settings.py`)
  gives access tokens a 15-minute default lifetime and refresh tokens 7
  days, with `ROTATE_REFRESH_TOKENS` and `BLACKLIST_AFTER_ROTATION` both
  on — every refresh returns a *new* refresh token and blacklists the
  one just used. `api/axiosInstance.ts`'s response interceptor catches a
  401 on any non-`NO_AUTH` request, exchanges the stored refresh token
  for a new access/refresh pair via a plain (non-recursive) `axios.post`
  to `/accounts/token/refresh/`, stores both, and replays the original
  request — transparently, once per request (see that file's own
  section for the concurrent-request queueing).
- *Q: Why does login authenticate by email instead of Django's default
  username field?* — `CustomTokenObtainPairSerializer`
  (`accounts/serializers.py`) sets `username_field = "email"` and maps
  `email`/`password` onto SimpleJWT's expected `username`/`password`
  attrs before delegating to the parent serializer — this app has no
  separate username concept anywhere in its forms or models, so forcing
  users through a second identifier would just be friction.
- *Q: What stops "forgot password" from being a second, unlimited way
  back into a deactivated account, bypassing the 30-day restore
  window?* — `PasswordResetRequestAPIView` and
  `PasswordResetConfirmAPIView` both explicitly check `is_active` and
  treat a deactivated account identically to an unknown email (same
  generic message, same 400 on confirm) — added in [[P0-04]] after a
  test had pinned the *opposite* behavior (silent reactivation) as
  correct. Only `AccountRestoreConfirmAPIView`, which enforces
  `ACCOUNT_RESTORE_WINDOW_DAYS`, can bring a deactivated account back.

**Payment integrity and idempotency**
- *Q: What actually prevents a duplicate Stripe webhook delivery from
  creating two orders for one payment?* — `stripe_webhook`
  (`orders/views_stripe.py`) checks
  `Order.objects.filter(user=, stripe_payment_intent=).first()` before
  doing anything else; if one already exists, it returns `{"ok": true}`
  immediately with no further work — Stripe's own retry-on-non-200
  behavior means this check has to run on *every* delivery, not just
  ones that look suspicious.
- *Q: What stops a refund from ever being issued twice for the same
  order?* — Two independent guards, deliberately redundant: application
  state (`refund_status == "initiating"` refuses a second concurrent
  attempt, and an existing `stripe_refund_id` refuses a second attempt
  entirely) and a Stripe-side `idempotency_key` unique to the order and
  payment intent (`cancel_order_{id}_{payment_intent}` /
  `return_refund_{id}_{payment_intent}` / `stock_sold_out_refund_{payment_intent}`)
  on every `stripe.Refund.create` call — even if the application-level
  guard somehow failed to catch a retry, Stripe itself would return the
  original refund instead of creating a second one for a repeated
  identical key.
- *Q: A payment was captured by Stripe but the webhook hit a branch
  where no order gets created — what happens to the money, and who
  finds out?* — Depends which branch. For most (missing metadata, user
  not found, empty cart, missing consent, a cart-signature mismatch),
  nothing is refunded automatically — only `send_checkout_webhook_alert`
  fires (Sentry + an email to `SUPPORT_EMAIL`), on the theory that these
  need a human to look at the specific situation. The one exception is
  insufficient stock, the only branch where the customer is refunded
  *and* emailed automatically with no human in the loop, since it's the
  only one where "give the money back" is unambiguously the right
  outcome regardless of the specifics — see [[P0-08]] and walkthrough 1
  step 8 above.

**Concurrency and stock**
- *Q: Two customers try to buy the last unit of a product size at
  nearly the same moment. What stops both webhooks from succeeding?* —
  `stripe_webhook` takes `select_for_update()` on each `ProductSize`
  line inside `transaction.atomic()` before checking `quantity <
  cart_item.quantity` — the second webhook to reach that lock waits for
  the first transaction to commit (or roll back), then sees the
  already-decremented quantity and takes the stock-shortage branch
  itself if there's nothing left, rather than both reading a
  stale "1 available" and both succeeding.
- *Q: How does the back-in-stock signal tell a real restock apart from
  the same `ProductSize` being saved for an unrelated reason — like the
  decrement that just happened in the paragraph above?* — It compares
  against a quantity snapshotted at `__init__`/`from_db` time
  (`self.__original_quantity`, `products/models.py`) and only proceeds
  if that stored value was `<= 0` **and** the new value is `> 0` — a
  purchase decrementing 5→4 doesn't match (previous value wasn't ≤ 0),
  an admin editing an already-positive quantity doesn't match either.
  See [[P0-02]] and walkthrough 4 above for what shipped without this
  guard, briefly, before it was added.

**Transaction boundaries**
- *Q: Why do the cancel and return-refund code paths split into three
  separate transactions instead of one, when they're conceptually a
  single operation?* — Because `stripe.Refund.create` is a network call
  to an external service, and holding a row lock
  (`select_for_update()`) across that round-trip would serialize every
  other request touching that order behind however long Stripe takes to
  respond. The three-phase shape ([[P0-09]]) — lock-and-mark-initiating,
  call-Stripe-with-no-transaction-open, record-the-result — means the
  row is only ever locked for the two short, local-database phases, and
  the `"initiating"` marker set in phase 1 (not a lock) is what prevents
  a second concurrent request from also calling Stripe while the first
  one's call is in flight.
- *Q: If phase 3 (recording the refund result) fails after Stripe has
  already issued the refund, what state is the order left in, and why
  is that the deliberately chosen behavior?* — `refund_status` stays
  `"initiating"` — the code does **not** clear it back to empty. That's
  intentional: an order silently reverting to "no refund" after Stripe
  already paid the customer back would be *worse* than an order stuck
  visibly showing "initiating," because the stuck state is at least
  discoverable (by reconciling against Stripe) instead of looking like
  nothing happened.
- *Q: Why does the order-confirmation email get sent from
  `transaction.on_commit` instead of right after `Order.objects.create()`
  in the webhook?* — So a transaction that gets rolled back later in the
  same block (a failure creating an `OrderItem`, decrementing stock, or
  clearing the cart) can never result in a confirmation email for an
  order that doesn't actually exist in the database. The same pattern
  protects every other order/return/restock email in this codebase —
  it's the one recurring idiom shared by `views_stripe.py`,
  `orders/views.py`'s `CancelOrderAPIView`, and `products/signals.py`'s
  restock handler.

**Data privacy and consent**
- *Q: What happens to a customer's personal data when they deactivate
  their own account?* — `DeleteAccountAPIView` (`accounts/views.py`)
  sets `is_active=False` and `deleted_at`, calls
  `user.set_unusable_password()`, and clears every address field on
  `UserProfile` (`address_line1`, `apartment`, `city`, `state`,
  `postal_code`, `country`) — but deliberately does **not** touch past
  `Order` rows, which keep their own copy of the shipping address and
  email at the time of purchase (each `Order` stores `full_name`,
  `address`, `email` directly, not a foreign key alone) — financial/
  order records are retained independent of the account's own profile
  data being cleared.
- *Q: What does this codebase do to comply with CAN-SPAM/GDPR's
  one-click-unsubscribe requirement for marketing email?* — [[P0-06]]:
  every newsletter email includes a signed, expiring unsubscribe link
  (`newsletter/tokens.py`) that requires no login and no re-entering an
  email address — clicking it alone deactivates the subscription. Before
  that fix, `is_active` existed on the model but nothing in the app
  could ever set it to `False`.
- *Q: Where is customer consent to policies actually captured, and how
  is it proven later rather than just assumed?* — `Order.policy_accepted`,
  `policy_version`, and `policy_accepted_at` are written at checkout
  time (`create_checkout_session`/the webhook, `orders/views_stripe.py`)
  from the `policy_accepted`/`custom_size_final_sale_acknowledged` flags
  `Order.tsx` requires the checkboxes for — captured per order, at the
  version of the policy in effect that day, not just as a single global
  "has this user ever agreed" flag that could drift out of sync with
  which policy text they actually saw.

**Testing strategy, and why a passing suite isn't proof**
- *Q: Give a concrete example from this codebase of a fully green test
  suite hiding a completely non-functional feature.* — [[P0-01]]: the
  back-in-stock `post_save` receiver was defined correctly and its three
  unit tests all passed, but `products/apps.py`'s `ready()` never
  imported the module that registers the `@receiver` decorator — so in
  the running app, the signal was never connected at all, and no restock
  email had ever been sent. The tests passed anyway because
  `patch("products.signals.send_back_in_stock_email")` imports the
  module as a side effect of patching it, which is what ran the
  decorator during the test — the tests proved the handler's *body*
  worked, never that anything in production would actually call it.
- *Q: Give a second example, from this pass specifically.* — This
  guide's own research found `send_account_restore_email` calling
  `render_to_string("emails/accounts/account_restore.txt", ...)` when
  the real file on disk is named `account_restore.txt ` with a trailing
  space — every call raises `TemplateDoesNotExist`, silently caught by a
  bare `except Exception`, so no restore email has ever actually been
  sent. All three tests covering this flow mock
  `send_account_restore_email` entirely, and — unlike `welcome.txt` and
  `account_deactivated.txt` in the same folder —
  `AccountEmailTemplatesRenderTestCase` has no real-render test for this
  one template, so nothing in CI ever calls `render_to_string` against
  the actual file. Both examples share the identical shape: the tested
  layer (a function's internal logic; a template's own content) was
  fine — what silently broke was the *wiring* connecting it to the rest
  of the app, which only a test that goes through the real integration
  point (a real signal dispatch; a real, unmocked render) can catch.
- *Q: What does `orders/tests.py`'s history say about testing refund
  logic specifically?* — [[P1-19]] added 32 new tests for the cancel,
  return, and admin refund flows and every one passed on the first run —
  "no bug was found and none was fixed," stated as the actual result,
  not a caveat. That's the boring, correct outcome of writing tests
  *before* assuming code is broken: sometimes the code was already
  right, and the value delivered is the coverage itself, not a fix.

**Deployment, migrations, and monitoring**
- *Q: What actually runs migrations against the production database,
  and is that guaranteed to happen on every deploy?* — Depends which of
  the two deploy configs in this repo runs: the `Procfile`
  (`web: python manage.py migrate --noinput && ... gunicorn ...`) runs
  migrations before every start; the `Dockerfile`'s `CMD` does **not** —
  it runs `collectstatic` and starts `gunicorn` directly, with no
  `migrate` step at all. **Unverified** which of the two is actually
  used for this project's live deploy (existing docs reference a
  deployed Railway backend, which supports either path) — but the two
  configs genuinely disagree with each other as committed, which is
  itself worth surfacing rather than assuming either one reflects what
  actually happens in production.
- *Q: How does this project keep a local `pytest` run from ever hitting
  live Stripe, Sentry, or email-sending credentials?* — `tresse/
  settings_test.py` sets dummy `STRIPE_SECRET_KEY`/`STRIPE_PUBLIC_KEY`/
  `STRIPE_WEBHOOK_SECRET`/`RESEND_API_KEY`/`SENTRY_DSN` values directly
  in `os.environ` *before* `from .settings import *` runs — since
  `settings.py` reads secrets through python-decouple, which checks
  `os.environ` before falling back to the real `.env` file, every
  `config(...)` call in `settings.py` picks up the dummy instead. This
  was added after the P0-08 work "found this the hard way" — an
  already-existing webhook test unexpectedly attempted a live Stripe
  refund once a real refund call was added to that code path.
- *Q: What CI actually checks before code reaches `main`, and what does
  it deliberately not check?* — `.github/workflows/ci.yml` runs, per
  side: backend — `manage.py check`, `ruff check`, `ruff format --check`,
  `pytest`; frontend — Biome lint, `npm run test:run` (Vitest), and a
  production `vite build`. It does **not** run `manage.py makemigrations
  --check` (so a model change committed without its migration wouldn't
  be caught here), and does **not** run the Playwright monkey test
  (`e2e/monkey-test.spec.ts`) at all — that spec is a local/manual tool
  only, per its own section above.
- *Q: How are unhandled errors and the "payment captured, no order
  created" family of webhook failures actually surfaced to a human?* —
  Sentry (`sentry_sdk.init`, gated on `SENTRY_DSN` being set,
  `tresse/settings.py`) for exceptions generally, plus the
  webhook-specific `send_checkout_webhook_alert` (`orders/emails.py`),
  which deliberately does *both* — a Sentry message with a
  reason-specific fingerprint, and a direct email to `SUPPORT_EMAIL` —
  each in its own `try/except` so a Sentry outage can't suppress the
  support email or vice versa. See [[P0-08]] and walkthrough 1 step 8.

**Accessibility**
- *Q: How is keyboard focus kept inside an open modal in this
  codebase?* — `hooks/useDialogDismiss.ts` implements a focus trap
  canonically once (Tab/Shift+Tab cycles only among the dialog's own
  focusable elements), documented in that hook's own section above; the
  same guide also notes it's hand-rolled independently in at least five
  other places rather than universally reused, which is the more
  interesting accessibility fact about this codebase than any single
  implementation — a consistent pattern exists, but its adoption is
  inconsistent.
- *Q: Where does this codebase gate third-party tracking scripts behind
  user consent, and why does that matter for accessibility as much as
  privacy?* — `utils/pixelLoader.ts`, `utils/metaPixel.ts`, and
  `utils/tiktokPixel.ts` all check
  `getCookieConsent()?.marketing` (`components/cookies/
  cookiePreferences.ts`) before loading anything — relevant here because
  third-party scripts loaded unconditionally are a common source of
  unexpected focus-stealing and layout shift that specifically harms
  keyboard and screen-reader users, on top of the privacy reason for the
  gate existing in the first place.

---

## Glossary

- **DTO (Data Transfer Object)**: this guide's term (and this codebase's,
  per `types/cart.ts`'s `CartItemDto`/`CartDto` naming) for a TypeScript
  type that mirrors a backend API response shape, as opposed to a type
  describing purely client-side/UI state (e.g. `ProfileFormState` vs.
  `ProfileResponse` in `types/profile.ts`).
- **Thunk**: a Redux Toolkit `createAsyncThunk`-produced async action —
  dispatching it runs an async function (typically an API call) and
  automatically dispatches `pending`/`fulfilled`/`rejected` actions
  around it, which a slice's `extraReducers` can handle.
- **Slice**: a Redux Toolkit `createSlice` call — bundles a piece of
  state, its reducers, and its action creators into one module. This app
  has four: `auth` (`utils/authSlice.ts`), `serverCart`
  (`store/serverCartSlice.ts`), `wishlist` (`store/wishListSlice.ts`),
  `cart` (`utils/cartSlice.ts`, the guest cart).
- **Guest cart vs. server cart**: two separate cart representations —
  the guest cart (`utils/cartSlice.ts`) is `localStorage`-backed,
  synchronous, and used before login; the server cart
  (`store/serverCartSlice.ts`) is fetched from and mutated on the
  backend, used once authenticated. `mergeGuestCart` transfers the
  former into the latter at login.
- **`lineId`**: a stable, generated (`crypto.randomUUID()`) identifier
  for one guest-cart line, distinct from the product/size ids it
  contains — introduced specifically so two lines for the same
  product+size with different custom measurements or length don't
  collide when removed, updated, or edited.
- **`onCloseRef` pattern**: reading a callback prop through a `useRef`
  that's updated every render (rather than putting the callback directly
  in a `useEffect`'s dependency array), so the effect doesn't re-run
  merely because the parent passed a new function *identity* on an
  unrelated re-render. Used in `hooks/useDialogDismiss.ts` specifically
  to stop a modal from re-stealing focus on every keystroke of a
  lifted-to-parent form field.
- **Focus trap**: keeping keyboard (Tab/Shift+Tab) focus cycling only
  among a modal dialog's own focusable elements, so a keyboard user can't
  tab out to the (visually hidden but still-in-the-DOM) page behind it.
  Implemented once, canonically, in `hooks/useDialogDismiss.ts`; also
  hand-rolled independently in at least five other places across this
  codebase (see that hook's and several view/component sections' "Watch
  out for" notes).
- **Optimistic update**: changing UI state immediately, before a
  server response confirms the change, to feel instant — this
  codebase's `store/wishListSlice.ts` `inc`/`dec` actions are explicitly
  documented as this pattern (with a warning that they need either a
  rollback or a re-sync). Most of this codebase's actual add/remove
  flows are **not** strictly optimistic — they wait for the request to
  resolve before updating local state (e.g.
  `view/ProductDetails.tsx`'s `handleWishlist` flips its local flag only
  *after* the request succeeds).
- **Consent gating**: only running a piece of behavior (loading a
  tracking script, firing a tracking event) when a stored user consent
  preference (`components/cookies/cookiePreferences.ts`) explicitly
  allows it. `utils/pixelLoader.ts`, `utils/metaPixel.ts`, and
  `utils/tiktokPixel.ts` all gate on `getCookieConsent()?.marketing`.
- **Stub (in the pixel-loading sense)**: a minimal reimplementation of a
  third-party SDK's own bootstrap object (e.g. `window.fbq`,
  `window.ttq`) that queues calls made before the real script finishes
  downloading, then hands off to the real implementation once it loads —
  built in `utils/pixelLoader.ts`'s `ensureFbqStub`/`createTtqStub`.
- **Debounce (hand-rolled)**: delaying an action (typically a network
  request) by a fixed time after the last triggering event, implemented
  in this codebase as a plain `window.setTimeout` set inside a
  `useEffect`, cleared in that same effect's cleanup function if the
  effect re-runs before the timer fires — used in
  `view/ProductCatalog.tsx` (250ms) and `view/Header.tsx` (250ms) for
  search/filter input.
- **`NO_AUTH` list**: a fixed list of URL prefixes an Axios response
  interceptor checks before deciding whether a 401 should trigger the
  app-wide "unauthorized" handler — exempts the auth endpoints
  themselves (login, register, refresh) so a failed login attempt
  doesn't trigger a logout-and-redirect.
- **`setOnUnauthorized`**: a single module-level callback slot on the
  Axios instance (`api/axiosInstance.ts`) that the app-wide 401 handler
  is registered into — whichever call to `setOnUnauthorized` runs last
  wins, since there's no list or queue.
- **Server-authoritative field**: a value the client should never trust
  its own copy of over what the server computes/returns — e.g.
  `custom_length_cm`/`custom_length_surcharge` on a cart item, which
  `CartItemSerializer` marks `read_only` and always derives from the
  product server-side, regardless of what (if anything) the client sent.
- **Snapshot (pricing)**: a value copied onto a record at the moment of
  an action, rather than referenced live — e.g. a cart line's
  `custom_length_surcharge` is the product's surcharge *at the time the
  item was added*, not a live lookup that would change if the product's
  surcharge changed later.
- **Ref guard**: a plain `useRef` boolean used purely to track "has this
  effect's one-time side effect already run," independent of the
  dependency array — e.g. `view/Cart.tsx`'s `didMergeRef`/
  `didHandleMetaCartRef`.
- **Idempotency key**: a caller-chosen string passed to a Stripe API call
  (`stripe.Refund.create(..., idempotency_key=...)`) so that retrying the
  exact same call — after a timeout, a crash mid-request, a duplicate
  webhook delivery — returns the original result instead of performing
  the action a second time. This codebase builds one from the order id
  and payment intent (`cancel_order_{id}_{payment_intent}`,
  `return_refund_{id}_{payment_intent}`,
  `stock_sold_out_refund_{payment_intent}`), so retried refund attempts
  for the same order can never double-refund even if every
  application-level guard somehow failed at once.
- **`select_for_update()`**: a Django ORM call that takes a row-level
  database lock (`SELECT ... FOR UPDATE`) for the duration of the
  current transaction, used throughout `orders/views_stripe.py` and
  `orders/views.py`/`orders/admin.py`'s refund actions so a concurrent
  request touching the same row waits instead of racing.
- **Three-phase refund pattern**: this codebase's shape for any refund
  that involves a network call to Stripe — lock and mark
  `refund_status="initiating"` in a short transaction; call Stripe with
  no transaction open; record the result in a new transaction — so a row
  is never locked across a slow external call, and a marker (not a lock)
  is what prevents a second concurrent attempt. Introduced in [[P0-09]];
  see Questions by topic's "Transaction boundaries" section above.
- **`transaction.on_commit(...)`**: schedules a callback to run only
  after the enclosing database transaction actually commits — used
  everywhere this codebase sends an email tied to a database write (an
  order confirmation, a cancellation, a restock notification), so a
  transaction that gets rolled back can never result in an email
  describing something that, in the end, never happened.
- **Signed token (`django.core.signing`)**: a value that encodes data
  (here, an email address) plus an HMAC signature keyed off Django's
  `SECRET_KEY` and a use-specific salt — tamper-evident, not encrypted:
  the encoded data is still readable, but altering it invalidates the
  signature. Used for the newsletter unsubscribe link
  (`newsletter/tokens.py`) specifically so a token can't be forged to
  unsubscribe a different address, and so a `SECRET_KEY` rotation
  invalidates every outstanding token as a side effect.
- **Real-render template test**: a test that calls `render_to_string`
  against the actual template file with the exact context a real caller
  would pass, as opposed to a test that mocks `render_to_string`
  entirely. This codebase has both kinds for different templates side by
  side (`NewsletterWelcomeTemplateRenderTestCase`,
  `AccountEmailTemplatesRenderTestCase`) — only the real-render kind
  would have caught the newsletter greeting bug ([[P1-08]]) or the
  `account_restore.txt` filename mismatch this guide's own research
  found (see Backend — email templates and Questions by topic above).
- **Signal (Django)**: a `post_save`/`pre_save`/etc. hook a model
  broadcasts on every save, which a separately-registered `@receiver`
  function can act on without the code that called `.save()` knowing
  anything about it. This codebase's one production use is
  `products/signals.py`'s back-in-stock notifier — and its own history
  ([[P0-01]]) is a caution about signals specifically: a receiver can be
  fully correct and still never run, because nothing connects it to
  Django unless the app's `AppConfig.ready()` explicitly imports the
  module that defines it.

---

*This guide covers every file under `tresse_frontend/src` (all `.ts`/`.tsx`
source files, entry points, and ambient type-declaration files), plus
`index.html`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`,
`biome.json`, `tsconfig.json`/`tsconfig.app.json`/`tsconfig.node.json`,
`package.json`, `e2e/monkey-test.spec.ts`, every file under `styles/`
(the two foundation files individually, the remaining 27 as one grouped
section), and — for the Backend sections and the four full-stack
walkthroughs above — every file under `tresse_backend/newsletter/`,
`tresse_backend/templates/emails/`, `tresse_backend/accounts/`,
`tresse_backend/products/`, and `tresse_backend/orders/`. See the top of
this document for the running file/fix count.*
