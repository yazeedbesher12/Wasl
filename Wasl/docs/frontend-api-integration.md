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

The browser calls the Next Node proxy at `/api/wasl`. Access/refresh cookies are
HttpOnly and SameSite=Lax, and Secure in production; JSON responses redact tokens.
Writes validate the request Origin. The proxy bounds incoming bodies, forwards
binary downloads privately and coalesces parallel refresh requests. Login,
context switching and logout notify other tabs to refresh their identity.

The current proxy's revocation/refresh coordinator is **one Node process**, held
across development recompilation. A server restart requires login. Run a single
instance for this pre-database development stage. Before multi-instance/serverless
deployment, replace the coordinator with a shared session store; cookie affinity
alone does not cover restarts. `WASL_API_URL` is server-only and
`WASL_WEB_ORIGIN` must be the exact external origin behind a reverse proxy.

## Verification commands

```sh
npx --yes pnpm@10.28.0 --filter @wasl/api test
npx --yes pnpm@10.28.0 --filter @wasl/web typecheck
npx --yes pnpm@10.28.0 --filter @wasl/mobile typecheck
npx --yes pnpm@10.28.0 --filter @wasl/web build
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
