# TRESSE Frontend — Codebase Guide

A file-by-file walkthrough of `tresse_frontend/src`, plus the top-level
config files, written for interview prep. Every claim below is checked
against the current code (not the audit's predictions, not a docs entry) —
where a file calls the backend, the matching Django view/serializer in
`tresse_backend` is cited by name. Anything that couldn't be confirmed
from the code itself is marked **unverified**. Two backend sections
(newsletter, email templates) are covered in the same depth as the
frontend, since the frontend sections that call into them deserve the
other half of the story spelled out rather than left as a "Backend:"
name-drop — see Backend — newsletter and Backend — email templates
below, and the four full-stack walkthroughs in How the pieces fit.

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

## How the pieces fit

Four walkthroughs, each naming the files involved in order, across both
codebases. The first is the everyday path; the other three are what
happens after the sale — a cancellation, a return, and a restock —
which between them touch almost every file in the two new Backend
sections above.

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
walkthroughs above — every file under `tresse_backend/newsletter/` and
`tresse_backend/templates/emails/`. See the top of this document for the
running file/fix count.*
