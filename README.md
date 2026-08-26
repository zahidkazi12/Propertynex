# PROPERTYNEX

**Find. Invest. Belong..**

A modern real-estate marketplace foundation — Next.js 16 (App Router) + TypeScript + Tailwind
CSS + MongoDB (via Prisma). This milestone ships the public marketing site, a real
session-based authentication system, and an **OTP-based password recovery flow** — a one-time
passcode sent to the email address or mobile number on the account.

---

## 1. Stack

| Layer          | Choice                                             |
|----------------|-----------------------------------------------------|
| Framework      | Next.js 16 (App Router, Server Components)          |
| Language       | TypeScript (strict mode)                             |
| Styling        | Tailwind CSS + custom glassmorphism utility classes  |
| Animation      | Framer Motion                                        |
| Database       | MongoDB                                               |
| ORM            | Prisma                                                |
| Auth           | Custom, cookie + server-verified session (no NextAuth) |
| Validation     | Zod (client + server)                                |
| Password hashing | bcryptjs (12 salt rounds)                          |
| Passcode hashing | HMAC-SHA256, keyed and session-bound               |
| OTP delivery   | Pluggable provider (Resend / Twilio), zero SDK deps  |

No authentication-as-a-service and no third-party email-verification vendor is used anywhere in
this codebase. Passcode *delivery* goes through a provider seam (`lib/otp/providers/`) that
reads its credentials from environment variables only; the passcode lifecycle — generation,
hashing, expiry, attempt limits, single-use enforcement — is implemented here, not bought in.

---

## 2. Getting started

### 2.1 Prerequisites

- Node.js **18.18+**
- A MongoDB instance running **as a replica set** — Prisma's MongoDB connector requires this
  even for a single local node, because it relies on MongoDB transactions.
  - **Easiest option:** a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster — these
    are already configured as replica sets.
  - **Local option:** see §2.4 below.

### 2.2 Install

```bash
npm install
```

`postinstall` automatically runs `prisma generate`.

### 2.3 Configure environment variables

```bash
cp .env.example .env.local
```

Fill in:

- `DATABASE_URL` — your MongoDB connection string
- `AUTH_SECRET` — a strong random string, e.g. `openssl rand -base64 32`
- `PASSWORD_RESET_SECRET` — a **different** strong random string
- `OTP_SECRET` — a **third, distinct** strong random string (min 16 chars), used to key the
  passcode HMAC. **Required, with no fallback.** It deliberately does *not* fall back to
  `PASSWORD_RESET_SECRET`: sharing one value would mean a single leak compromised recovery
  tokens *and* every live passcode digest at once. The app refuses to issue or verify a passcode
  without it, and the resulting error never echoes any secret's value.

All three live only in `.env` / `.env.local`, which are gitignored — never commit them.

Passcode delivery also needs a provider per channel. In development both default to `console`,
which prints the passcode to the server console — that is enough to exercise the whole flow
locally, and the console provider **refuses to run with `NODE_ENV=production`**. For a real
deployment set `OTP_EMAIL_PROVIDER=resend` / `OTP_SMS_PROVIDER=twilio` and their credentials;
see `.env.example` for the full list.

Then push the schema to your database (MongoDB has no formal migration files — `db push`
syncs the Prisma schema directly):

```bash
npx prisma db push
```

Run the dev server:

```bash
npm run dev
```

Visit `http://localhost:3000`.

### 2.4 Running the tests

Unit tests (passcode crypto, identifier parsing, provider configuration guards) need nothing
but Node — they use the built-in `node:test` runner, so no test framework is installed:

```bash
npx tsc -p tests/tsconfig.json
node --test "tests/.build/tests/unit/*.test.js"
```

Integration tests drive the real recovery flow over HTTP. They need a running dev server and a
reachable MongoDB, and they read delivered passcodes out of the dev server's own console output
— the passcode is never returned over HTTP, so the delivery channel is the only way to obtain
it, which is precisely the property under test. Start the server with its output captured, then
point the suite at both:

```bash
npx next dev --port 3100 > dev-server.log 2>&1 &
BASE_URL=http://127.0.0.1:3100 DEV_LOG_PATH=dev-server.log \
  node --env-file=.env --test tests/integration/otp-flow.test.mjs
```

The suite creates its own accounts, cleans them up afterwards, and pins itself to a dedicated
`x-forwarded-for` address so its rate-limit budget is isolated from anything else using the
same server.

**Stopping the dev server.** It runs independently of the tests — nothing in the application
starts or stops it. Kill it with Ctrl-C in its own terminal, or by PID:

```bash
# if it was started with output redirected, e.g. for the integration suite
kill $(cat devpid.txt)          # macOS / Linux
Stop-Process -Id (Get-Content devpid.txt)   # Windows PowerShell
```

`dev-server.log` and `devpid.txt` are gitignored build artefacts, not application files.

**Production fail-closed check.** `tests/integration/production-failclosed.mjs` verifies against a
real `next start` server that production refuses to send a passcode without a configured provider
— generic 503, no token issued, and nothing resembling a passcode in the response or the server
log. Run it with no OTP provider configured, and again with `OTP_EMAIL_PROVIDER=console` set, to
confirm the dev-only provider is unreachable in production:

```bash
npx next build
npx next start --port 3101 > prod-server.log 2>&1 &
BASE_URL=http://127.0.0.1:3101 PROD_LOG_PATH=prod-server.log \
  node tests/integration/production-failclosed.mjs
```

Note that `next build` runs `prisma generate`, which cannot replace the query-engine binary while
a dev or production server is holding it — stop any running server first, or the build fails with
`EPERM ... query_engine-windows.dll.node`.

### 2.5 Running MongoDB locally as a single-node replica set

```bash
mkdir -p ~/mongodb-data
mongod --replSet rs0 --dbpath ~/mongodb-data --port 27017 &
mongosh --eval "rs.initiate()"
```

Then use `DATABASE_URL="mongodb://localhost:27017/propertynex?replicaSet=rs0"`.

### 2.6 Build and check status

Unlike the original foundation drop (assembled without outbound network access, so nothing
could be executed), the OTP milestone was built and checked against a real MongoDB. As of this
change, on Node 24 / Next 16.3.1 / Prisma 6.19.3:

| Check | Command | Result |
|-------|---------|--------|
| Type-check | `npx tsc --noEmit` | passes |
| Lint | `npm run lint` | passes (0 errors; 1 pre-existing warning, below) |
| Production build | `npm run build` | passes |
| Unit tests | see §2.4 | 47/47 pass |
| Integration tests | see §2.4 | 32/32 pass |
| Production fail-closed | see §2.4 | passes (both scenarios) |

The lint warning is an unused `eslint-disable` for `no-control-regex` at
`lib/validation/property.ts:72`. It is a stale comment, not a code defect, and was left in place
rather than removed during a frontend change to a validation module — a one-line follow-up.

Note that `npm run lint` was changed from `next lint` to `eslint .`, and `.eslintrc.json` was
replaced by `eslint.config.mjs`: Next 16 removed the `next lint` command, and
`eslint-config-next@16` ships a flat config that ESLint 9's eslintrc loader cannot consume, so
linting had been failing to run at all rather than reporting a clean result.

---

## 3. Project structure

```
app/
  page.tsx                     Landing page
  buy/page.tsx                 Public browse — listings with listingType BUY
  rent/page.tsx                Public browse — listings with listingType RENT
  sell/page.tsx                Owner-facing explainer + signup CTAs
  not-found.tsx
  login/page.tsx
  signup/page.tsx
  forgot-password/page.tsx     4-step OTP recovery flow
  dashboard/
    layout.tsx                 Server-side session gate (defense in depth)
    page.tsx                   Overview + development progress
    profile/page.tsx
  api/
    auth/
      signup/route.ts
      login/route.ts
      logout/route.ts
      session/route.ts
      forgot-password/
        start/route.ts         Step 1 — accept email/mobile, open session, send passcode
        verify-otp/route.ts    Step 2 — verify passcode server-side, rotate token
        resend/route.ts        Re-send a passcode (cooldown + resend cap)
        reset/route.ts         Step 3 — reset password, only if stage === OTP_VERIFIED
    profile/route.ts
    properties/
      route.ts                 Owner-scoped list + create
      [id]/route.ts            Owner-scoped read, update, delete
      [id]/status/route.ts     Status transitions (publish, unpublish, submit)
components/
  layout/      Navbar, Footer, Logo, PageShell, background effects
  landing/     Hero, intent actions, feature sections, development progress panel
  marketplace/ BrowseView, ListingCard, ListingFilters, IntentSwitch, Pagination
  auth/        Forms, shared field components, OTP input, resend control, recovery flow
  dashboard/   Sidebar, topbar, profile form, stat cards
  ui/          Small shared primitives (Alert, SelectField, Reveal)
lib/
  auth/        session.ts, password-reset-session.ts, password.ts,
               security-questions.ts (legacy, unused), rate-limit.ts
  otp/         config.ts, code.ts, send.ts, providers/
  properties/  constants.ts (labels), format.ts (price/area/date display),
               access.ts, ownership.ts, status.ts, serialize.ts (owner-scoped),
               public.ts (read-only public browse — see §7.6)
  utils/       identifier.ts, timing.ts, api-response.ts, cn.ts
  validation/  Zod schemas
  db/          Prisma client singleton
types/
  index.ts                     Serialized DTOs (SafeUser, SafeProperty, PublicListing, …)
prisma/
  schema.prisma
tests/
  unit/        Passcode crypto, identifier parsing, provider guards (node:test)
  integration/ Full HTTP recovery flow against a running dev server
middleware.ts                  Edge-layer route protection (paired with server-side checks)
```

---

## 4. Security architecture

### 4.1 Authentication

- Passwords are hashed with **bcrypt (12 rounds)** — never stored or logged in plaintext.
- Sessions are **server-verified**, not JWT-only: the browser cookie holds a random opaque
  token; the database stores only an **HMAC of that token**. A database leak alone can never
  be replayed as a valid session, and a stolen cookie is useless without a live `Session`
  document.
- The cookie is `httpOnly`, `sameSite=lax`, and `secure` in production — it is never readable
  or writable from client-side JavaScript, so it cannot be exfiltrated via XSS or forged from
  `localStorage`.
- Every protected page is checked in **two layers**: `middleware.ts` does a cheap
  "does a session cookie exist" check at the edge to redirect obviously-unauthenticated
  requests immediately, and each protected layout/API route calls `getCurrentUser()`, which is
  the actual authority — it hashes the cookie and looks up a live, unexpired session in
  MongoDB. Middleware alone is never trusted for authorization.

### 4.2 OTP password recovery

Recovery is a **one-time-passcode** flow, delivered to the email address or mobile number
already on the account. It is a stage-gated, server-controlled state machine
(`PasswordResetSession` in `prisma/schema.prisma`):

1. **`POST /api/auth/forgot-password/start`** — user submits an email address *or* a mobile
   number in a single field. The server opens a `PasswordResetSession`, generates a 6-digit
   passcode, stores only a keyed HMAC of it, and hands the client an **opaque random token**.
   The passcode itself goes out over the delivery provider and is never returned in the
   response.
2. **`POST /api/auth/forgot-password/verify-otp`** — user submits the token + the passcode. The
   server compares in constant time against the stored HMAC. On success it clears the passcode
   (making it single-use), **rotates the session token**, moves the stage to `OTP_VERIFIED`, and
   shortens the expiry to a 10-minute reset window.
3. **`POST /api/auth/forgot-password/reset`** — user submits a new password. The server
   **re-checks that the stage is `OTP_VERIFIED`** before allowing anything: a client can never
   skip here with a self-made "verified: true" flag, because the stage lives in the database.
   On success the session is marked `used` and **every existing login session for that user is
   revoked**, so a reset also logs the account out everywhere.

`POST /api/auth/forgot-password/resend` issues a replacement passcode, subject to a
60-second cooldown and a per-session cap.

**Passcode handling.** Codes are generated with `crypto.randomInt` (uniform, no modulo bias,
leading zeros preserved) and stored as `HMAC-SHA256(OTP_SECRET, sessionTokenHash + ":" + code)`.
Two properties follow: the HMAC is *keyed*, so a database leak cannot be brute-forced back to a
live code the way an unkeyed hash of a 6-digit value trivially could; and it is *bound to the
session*, so a digest observed in one row cannot be replayed into another. Verification is
`timingSafeEqual`. Policy — 10-minute code TTL, 60-second resend cooldown, 5 attempts per code,
3 resends per session — lives in `lib/otp/config.ts`, deliberately **not** in environment
variables, because it is security policy rather than deployment configuration.

**Delivery providers.** `lib/otp/providers/` is a small seam: the flow hands an `OtpMessage` to
whichever `OtpProvider` the environment selects and never sees a credential. Resolution is
**fail-closed** — a channel with no provider configured returns a generic "temporarily
unavailable" error rather than pretending a code was sent. Shipped implementations are `resend`
(email) and `twilio` (SMS), both plain `fetch` against their REST APIs so no SDK dependency is
added, plus a `console` provider for development that **refuses to construct when
`NODE_ENV=production`**. There is no fake-verification path anywhere: verification is always
the real HMAC comparison with real expiry and real attempt limits, regardless of provider.

### 4.3 Account-enumeration protection

The recovery endpoints answer identically whether or not an identifier belongs to an account.
That takes more than a shared error string, so all of the following hold:

- **Same body, same status.** Both paths return 200 with the same fields. The masked
  destination echoed back is a redaction of *what the caller typed*, never of anything read
  from the database.
- **A real session either way.** An unknown identifier still gets a `PasswordResetSession` row
  with `userId: null` and a real, randomly generated passcode that is simply never delivered.
  Every follow-up call therefore behaves the same as for a real account — same cooldown, same
  attempt budget, same "that code is not right" response. (The previous security-question flow
  handed back an *unpersisted* decoy token, which made step 2 answer "session expired" for
  unknown identifiers and "incorrect answer" for real ones — an oracle this closes.)
- **Same timing.** The real path does a user lookup and a provider round-trip the decoy path
  does not, so every response from `start` and `resend` is padded to a floor
  (`START_RESPONSE_FLOOR_MS`). Identical bodies with a 400 ms tell are still an oracle.
- **Config faults are channel-wide.** Provider configuration is checked *before* the account
  lookup, so a deployment missing credentials fails the same way for every identifier.
- **Delivery faults do not change the answer.** A configured provider that rejects one message
  still yields the standard success body; the failure is logged server-side and the user can
  resend.

A *format* error is reported plainly ("enter a valid email address or mobile number") — that
describes the input, not the account.

### 4.4 Security questions (legacy)

Security questions are **no longer used for password recovery**. `User.securityQuestionId` and
`User.securityAnswerHash` survive as **optional** columns so existing rows stay valid, and
`lib/auth/security-questions.ts` keeps the catalog and hashing helpers so those stored ids
remain interpretable — but nothing in any current flow reads them, and signup no longer
collects them. The per-user failed-answer and lockout counters, which existed only to
rate-limit answer guessing, were removed.

They should not be wired back into recovery: a security answer is a low-entropy secret that is
often discoverable from public information, and unlike a passcode it proves nothing about
present control of the contact address an account is registered to.

### 4.5 Rate limiting

`lib/auth/rate-limit.ts` implements a sliding-window limiter applied to signup, login, and all
four password-recovery endpoints. `start` is limited **twice** — per IP (stops one host sweeping
many identifiers) and per identifier (stops a distributed sweep hammering one account). The
per-identifier key is a truncated SHA-256 digest, so the limiter never holds raw contact details.

**It is in-memory and single-instance.** The default store is a `Map` in one Node process, which
means counters reset on restart and are *not* shared across instances — behind a load balancer or
on serverless, the effective limit is (configured limit × number of instances). That is correct
for development and for a genuine single-instance deployment, which is what this milestone
targets; it is not sufficient for a horizontally scaled one.

**Replacing it later requires no change to OTP logic.** The passcode flow never touches the Map.
It calls `checkRateLimit`, which delegates to whichever `RateLimitStore` is installed:

```ts
export interface RateLimitStore {
  readonly name: string;
  consume(key: string, limit: number, windowMs: number): RateLimitResult | Promise<RateLimitResult>;
}

setRateLimitStore(new MyRedisRateLimitStore(...)); // once, at startup
```

`checkRateLimit` is already `async` for exactly this reason — a network-backed store slots in
without turning synchronous call sites into asynchronous ones after the fact. `tests/unit/
rate-limit.test.ts` pins this down by installing an async recording store and asserting the
recovery endpoints' calls reach it unchanged.

**No such dependency is installed.** Upstash is not in this project and was not added; the seam
is preparation, not an integration. The synchronous `rateLimit` used by signup and login stays
pinned to the in-memory store deliberately — a sync signature cannot await a network round-trip,
so routing it through a Redis store would silently keep per-process counters. Migrating those two
routes is a one-line change each when wanted.

### 4.6 Input validation

Every API route validates its body with a **Zod schema** server-side (client-side validation
in the forms is a UX convenience only — the server never trusts it). Error responses return a
generic, non-revealing message plus a `fieldErrors` map for form highlighting; stack traces and
internal error details are logged server-side only, never sent to the client.

---

## 5. What's implemented vs. what's next

**Accounts and recovery:**
- Landing page (hero, intent actions, feature sections, development-progress panel, footer)
- Signup, login, logout
- Full session lifecycle (creation, verification, revocation)
- OTP password recovery (4-step, server-gated, email or mobile) with a pluggable delivery
  provider, enumeration protection, and unit + integration test coverage
- Protected dashboard shell + profile management
- Responsive, glassmorphism-styled UI across all breakpoints

**Property data layer:**
- `Property` and `Inquiry` models, 14 property types, draft → published → verified statuses
- Owner-scoped REST API: list, create, read, update, delete, and status transitions
- Zod validation per property type, ownership checks on every mutation
- Display helpers for Indian price grouping, area, configuration, floor and age

**Public marketplace (this milestone):**
- Navbar and footer links are live: `/`, `/buy`, `/sell`, `/rent`, `/#about`
- Buy / Sell / Rent intent cards on the homepage
- `/buy` and `/rent` browse live listings with search, property type, price range,
  bedrooms, sort and pagination — all held in the URL, so any result set is shareable
- `/sell` explains the owner side and routes to signup / dashboard
- Listings are read through a dedicated public projection that omits the exact address,
  coordinates and every contact field (§7.6)

**Still to build:**
- Owner-facing listing form (`My Properties` in the dashboard sidebar is still disabled)
- Individual listing detail pages, so `/buy` cards can link somewhere
- Inquiry submission UI (the model exists; nothing writes to it yet)
- Agent directory, map search, messaging, notifications
- Admin panel (verification is a real status but has no reviewer UI), payments

---

## 6. Manual test checklist

- [ ] Sign up with a new email/phone → redirected to dashboard, session cookie set
- [ ] Sign up again with the same email → clear, field-level error, no account created
- [ ] Log out → dashboard/profile routes redirect to `/login`
- [ ] Log in with wrong password → generic "Invalid email or password", no hint which was wrong
- [ ] Forgot password with your email → passcode appears in the dev server console (dev only)
- [ ] Forgot password with your mobile number, re-typed with different spacing → still resolves
- [ ] Enter a wrong passcode → "not correct", with the remaining attempt count
- [ ] Enter the correct passcode → new password → forced logout → log in with new password works
- [ ] Old password no longer works after the reset
- [ ] Try the same passcode twice → refused the second time
- [ ] Wrong passcode 5x → session locked out, even for the correct code
- [ ] Resend before the 60s cooldown → refused with the remaining wait; after it → new code
      arrives and supersedes the old one
- [ ] Forgot password for an address with no account → identical screen, identical wording, and
      a wrong code there behaves exactly as it does for a real account
- [ ] Try opening `/dashboard` directly while logged out → redirected to `/login?redirectTo=/dashboard`
- [ ] Every navbar link goes somewhere: `/`, `/buy`, `/sell`, `/rent`, and About scrolls to the
      About section — including when you click About from `/buy` (it should navigate home first)
- [ ] On `/buy`, the Buy pill is lit and stays lit after a filter change; on `/rent`, Rent is
- [ ] Filter on `/buy`, then copy the URL into a new tab → the same filters and results come back
- [ ] Switch Buy → Rent with filters applied → filters carry over, page resets to 1
- [ ] With no published listings, `/buy` and `/rent` say nothing is listed yet and offer `/sell` —
      not "no results match your filters"
- [ ] Stop MongoDB and reload `/buy` → "Listings are temporarily unavailable", not a 500
- [ ] Resize every page from 320px to 1920px — no horizontal scroll, no overlapping elements;
      check the six passcode boxes stay on one line at 320px

---

## 7. Routing notes and deferred items

### 7.1 `/profile` removed from middleware protection

`middleware.ts` used to protect a `/profile` prefix. No such route exists — the profile page is
`/dashboard/profile`, and nothing in the app links to a bare `/profile`. Protecting a
non-existent route gave no security benefit (unauthenticated requests were redirected to login;
authenticated ones still got a 404) while implying a second protected area existed.

It was removed rather than backed by a new page: `/dashboard/profile` is the intended location,
so adding `/profile` would be a duplicate route for the same thing. `/dashboard` still matches
`/dashboard/profile` by prefix, so profile pages remain protected exactly as before.

### 7.2 Navbar marketplace links (now live)

Explore / Buy / Rent / Sell once all pointed at `/#features` — four labels, one anchor, which
reads as four working destinations. They were then made deliberately inert (`enabled: false`,
muted, "coming soon") because no marketplace route existed, and linking to `/explore` would have
traded one misleading anchor for four hard 404s.

Both of those states are gone. The routes exist, so the links are ordinary links and the
`enabled` / `plannedHref` machinery has been deleted rather than left dormant:

| Label | Route | Active when |
|-------|-------|-------------|
| Home | `/` | the `#home` section is in view |
| Buy | `/buy` | `pathname === "/buy"` |
| Sell | `/sell` | `pathname === "/sell"` |
| Rent | `/rent` | `pathname === "/rent"` |
| About | `/#about` | the `#about` section is in view |

Two details worth keeping in mind when editing `components/layout/Navbar.tsx`:

- A nav item is either a **route** (`route: "/buy"`, matched against `pathname`) or a
  **section** (`sectionId: "about"`, matched against the scroll-spy's current section). One
  helper, `isLinkActive`, reads both, so desktop and mobile cannot disagree about which pill is
  lit.
- About is `/#about`, **not** `#about`. A bare hash resolves against the current path, so from
  `/buy` it would try `/buy#about` and land nowhere. The leading `/` sends the visitor home
  first, which is where the About section lives.

`components/layout/Footer.tsx` was updated in the same pass — its nav column now mirrors these
five links, and the "Coming Soon" column lists what is genuinely still unbuilt (listing detail
pages, agent directory, map search, messaging).

Dropped from the plan recorded here previously: there is no `/explore` route and no
`?intent=buy` query parameter. Buy and Rent are separate pages sharing one implementation
(`components/marketplace/BrowseView.tsx`), which keeps each intent's copy, empty states and
metadata honest without duplicating the page. Sell does **not** point at
`/dashboard/properties/new`; that route does not exist yet (§5).

### 7.3 `middleware.ts` → `proxy.ts` migration: deferred

Next 16.3.1 renames the middleware file convention to `proxy.ts` and prints a build warning
pointing at a codemod (`npx @next/codemod@canary middleware-to-proxy .`).

**Not applied here, deliberately.** `middleware.ts` still works in 16.x — the build succeeds and
the route table lists it as "Proxy (Middleware)" — so this is a deprecation notice, not a
breakage. The migration touches the file that gates every protected route in the app, and folding
a framework migration into a security cleanup would make both harder to review. Left for the
final audit, where it can be done and verified on its own.

### 7.4 `AGENTS.md` / `CLAUDE.md`

Generated automatically by `next dev` on Next 16 (disable with `agentRules: false` in
`next.config.mjs`). They are editor/agent hints, not application code — nothing imports them and
no behaviour depends on them. Safe to delete or keep; neither was treated as application code
during this cleanup.

### 7.5 Test commands

Run via the documented commands in §2.4. `package.json` intentionally has **no** `test` scripts —
adding them was declined, so the commands live in this README instead. The only script changed at
any point was `lint` (`next lint` → `eslint .`), which was necessary because `next lint` no longer
exists in Next 16.

### 7.6 `lib/properties/public.ts` — why a second read path exists

`/buy` and `/rent` needed to render real listings, and nothing that existed could serve them:
`GET /api/properties` is scoped to `ownerId` and gated on a session, which is correct for a "my
properties" endpoint and useless for an anonymous visitor. The alternatives were to loosen that
endpoint's auth or to invent sample listings; both are worse than adding a read path.

So `lib/properties/public.ts` was added. What it is:

- **Read-only.** One `findMany` and one `count`. No writes, no status transitions, no ownership
  logic — none of `access.ts`, `ownership.ts` or `status.ts` is touched or duplicated.
- **Filtered to live listings** by the existing `LIVE_STATUSES`, and it queries on the
  `[status, …]` compound indexes `prisma/schema.prisma` already documents as being there for
  public browse.
- **Narrower than `SafeProperty` on purpose.** `toPublicListing` copies fields one by one — never
  a spread — and returns `PublicListing`, which has no `ownerId`, no `addressLine1/2`, no
  `pincode`, no coordinates, no `mapsUrl`, and no contact fields at all. `ContactPreference.IN_APP`
  therefore cannot be violated by a browse page: there is no code path through which a phone
  number or email could reach one.
- **Non-throwing.** A missing or unreachable database returns `available: false`, which renders
  "Listings are temporarily unavailable" instead of a 500 — and is kept distinct from "no listings
  match your filters" and "nothing is published yet", because those three mean different things
  to a visitor.

Nothing under `app/api/`, `lib/auth/`, `lib/otp/` or `prisma/` was modified to make this work.
If a single public listings endpoint is preferred later, this module is the natural body for it.
