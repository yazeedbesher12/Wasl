# Web and native API integration

The default web and React Native entry points use authenticated API records.
Old web `/demo` bookmarks redirect to `/login`; the previous browser snapshot
is preserved without being read or overwritten. The native snapshot can be
selected explicitly with `EXPO_PUBLIC_WASL_MODE=demo`. Connected workspaces never read,
overwrite or fall back to a demo snapshot. Arabic/English presentation and the
existing educational artwork/styles are retained.

## Run before connecting PostgreSQL

From the nested `Wasl` workspace, install dependencies and build shared contracts:

```sh
npx --yes pnpm@10.28.0 install
npx --yes pnpm@10.28.0 --filter @wasl/shared build
```

Copy `apps/api/.env.memory.example` to `apps/api/.env`. Set a local development
password (12–72 UTF-8 bytes) and two distinct random JWT secrets (32+ characters).
Start the actual Nest services with the development memory adapter:

```sh
npx --yes pnpm@10.28.0 --filter @wasl/api dev:memory
```

Copy `apps/web/.env.example` to `apps/web/.env.local`, then start:

```sh
npx --yes pnpm@10.28.0 --filter @wasl/web dev
```

Open `http://localhost:3000/login`. The API's fictional accounts share the configured
development password: `platform@wasl.test`, `admin1@wasl.test`,
`teacher1@wasl.test`, `student1@wasl.test`, and `parent@wasl.test`.
There are no hardcoded passwords or identity bypasses. See the
[Phase 1 guide](backend-phase1.md) for the other school's accounts.

Memory records reset on API restart; file bytes alone do not preserve their
metadata. Persistent PostgreSQL/Prisma setup, migrations, RLS and private S3/MinIO
verification remain the next infrastructure phase.

## Native device

Copy `apps/mobile/.env.example` to `apps/mobile/.env`. Set `EXPO_PUBLIC_API_URL`
to a reachable API URL. A physical phone cannot reach the computer using
`localhost`; use the computer's private LAN address. The memory API binds to
loopback by default. To test on a trusted private network, explicitly set
`WASL_MEMORY_HOST=0.0.0.0` in `apps/api/.env` and restart it. Use HTTPS for deployed
environments. Expo web also requires its exact origin in API `CORS_ORIGINS`.

```sh
npx --yes pnpm@10.28.0 --filter @wasl/mobile start
```

The native app uses Expo SecureStore for access/refresh tokens, serialized writes,
one refresh in flight and account generation checks. Expo web keeps tokens in
memory for its current run and requires login after reload. AsyncStorage contains
only the display language in connected mode. Files use DocumentPicker, actual
multipart uploads, authenticated downloads and temporary share files that are
removed after sharing. Device-level SecureStore/picker/sharing still need a
physical Android/iOS test.

## Connected workflows

| Role | API-backed operations |
| --- | --- |
| Platform admin | Schools, suspension/reactivation, administrator provisioning, own profile |
| School admin | Accounts, memberships, academic structure, assignments/enrollments, verified parent links, announcements, notifications |
| Teacher | Classes, units/lessons, actual files/links, question banks, assessment question selection/order, publication/closure, submissions, marking and result release |
| Student | Published learning, own answer drafts, final submission receipts, uploaded answers and released results |
| Parent | Approved children across schools, read-only child learning and explicitly released child results |

Forms expose the supported API fields and keep their input on failed writes.
Context changes clear old records; requests completing for an old account are
ignored. Unavailable services show a retry state. Unreleased marks and author
answer keys are never supplied to student/parent views. Parent child projections
recheck verified links, active identities, school and enrollment on each request.

## Web session deployment model

The browser calls the Next Node proxy at `/api/wasl`. Access and refresh
cookies are HttpOnly and SameSite=Lax, and Secure in production. JSON responses
redact tokens. Writes validate the request Origin. The proxy bounds request
bodies, forwards binary downloads privately, and coalesces parallel refresh
requests.

Login and school switching select an opaque web-session slot. Credential
cookie names include that slot, so a delayed logout can clear its own cookies
after a newer login without clearing the newer credentials. The HttpOnly
selector can remain after sign-out. It cannot authenticate a request by itself.
The proxy invalidates the local slot and clears its credential cookies even
when the API cannot confirm revocation. It returns 503 for unconfirmed
revocation. For five minutes, the same process can retry the exact API family
revocation using the original slot, without restoring local authentication or
keeping the refresh credential in the browser.

Production requires `WASL_WEB_SESSION_MODE=single-instance`. Run one Next
Node process and set `WASL_WEB_ORIGIN` to the exact public origin. The
server-only API URL is `WASL_API_URL`. Restart discards local sessions and pending
revocation retries. Browsers must sign in again, and an outstanding server-side
revocation can remain unconfirmed. A browser that still holds its refresh
credential can submit logout after a restart. Old fixed-name credential
cookies require sign-in after the web cutover.

The API persists session-family revocation, but does not provide a shared
store for web slots, refresh coordination and pending retries. Do not run the
proxy as multiple replicas, clustered Node workers or serverless instances
with this mode. Cookie affinity cannot preserve retry state across restart
or failover. Before scaling, select a shared server-side store with expiry,
atomic slot invalidation and refresh coordination, and protected storage for
pending revocation credentials. Validate recovery and two-instance behavior
with the intended deployment topology.

## Verification commands

```sh
npx --yes pnpm@10.28.0 --filter @wasl/api test
npx --yes pnpm@10.28.0 --filter @wasl/web typecheck
npx --yes pnpm@10.28.0 --filter @wasl/mobile typecheck
npx --yes pnpm@10.28.0 --filter @wasl/web build
npx --yes pnpm@10.28.0 --filter @wasl/web test:session
# Once per machine, install Chromium for the browser integration runner:
npx --yes pnpm@10.28.0 --filter @wasl/web exec playwright install chromium
npx --yes pnpm@10.28.0 --filter @wasl/web test:integration
# Export Expo web and exercise the native React Native UI in Chromium:
npx --yes pnpm@10.28.0 --filter @wasl/web test:mobile
```

The browser runner starts isolated memory API/Next processes with randomized
credentials and temporary private files. It covers five roles, cookies/CSRF/refresh,
authoring → draft → final submission → marking → release → student/parent results,
real file byte download, announcements/notifications, school/account creation,
unavailable-service retry and logout. It opens one role's browser at a time to
bound memory usage. `WASL_TEST_ARTIFACTS` optionally saves screenshots;
`WASL_CHROMIUM_EXECUTABLE` and JSON `WASL_CHROMIUM_ARGS` support an installed
alternative Chromium binary. API tests also exercise the native transport against
real Nest endpoints, including parallel refresh rotation and revoked sessions.

## Observed verification (2026-11-23)

- Nest memory API: **129 tests passed in 8 suites**, including parent projections,
  private file authorization and native client refresh/restore.
- Shared/API/web/native TypeScript checks passed.
- Next production build passed. Seven hook-dependency warnings remain in historical
  snapshot components; the connected components have no lint errors.
- Browser integration exercised all five roles and the complete teacher/student/
  parent result lifecycle, actual uploaded/downloaded bytes, communication, account
  creation, outage recovery and session clearing.
- Expo web production export and the native UI browser flow passed: sign-in,
  selected MCQ answers, saved/resumed draft, final submission, receipt, published
  learning, logout and verified parent access.

These checks use the real API with its memory repository and local private file
store. They do not verify PostgreSQL/RLS, a live S3 bucket, mobile push delivery,
physical device SecureStore/picker/sharing or an Android/iOS release build.
