# Backend Phase 1 — implementation and manual handoff

Backend now, database connection later. NestJS remains the backend; the Prisma
schema is unchanged. Web/native still use their existing local demo, artwork and
snapshot format. No frontend API integration is enabled in this phase.

## Architecture

`Controllers → FoundationService/AuthService → FoundationStorage.run → repositories`

- Controllers use concrete validated request DTOs. Unknown writable fields and
  query keys are rejected. Public response mappers exclude hashes and internal
  scope flags; Swagger response schemas are public models only.
- `repositories.ts` defines the fixed identity, school catalog, school people,
  seven-model academic and parent-link operations. It is not a query DSL or a
  replacement ORM. The same services and guards run in both storage modes.
- `MemoryStorage` is one singleton per server process. Every operation runs behind
  a serialization queue against a cloned draft. Commit happens only on success;
  failures roll back. Its adapters enforce phase-relevant unique/FK constraints,
  while services enforce role, membership, dates and relationship rules.
- `PrismaStorage` implements the identical operations with real Prisma queries.
  One serializable interactive transaction covers checks and all writes. Tenant
  settings are set on that transaction and every repository uses its `tx` client.
  P2034 retries restart the whole operation (up to three attempts). There are no
  per-statement nested transactions. Unique/FK/not-found conflicts are mapped to
  safe HTTP errors. There is no automatic memory fallback.
- Configured memory mode does not import, instantiate, generate or connect the
  Prisma runtime. `dev:memory` sets the driver before importing the app; production
  explicitly rejects it. Redis, object storage, and database URLs are not needed.
  All memory data and token hashes disappear on server restart. Multiple processes
  have separate memory stores and must not be treated as a shared deployment.

See [schema mapping](backend-schema-mapping.md) for exact enum/field differences
from the frontend and [database handoff](database-handoff.md) before Prisma mode.

## Authentication and scope

Login normalizes email, verifies bcrypt, rechecks active identity, and selects a
deterministic available membership. Invalid credentials/unavailable login roles
use a generic failure. Access tokens require signed HS256, issuer `wasl`, audience
`wasl-clients`, expiry, UUID subject and membershipId. Both the global guard and
the service operation recheck current membership, user and school availability.
JWT claims are not trusted as a permanent authority grant.

Refresh tokens are opaque authenticated-encrypted random tokens. Only SHA-256
hashes are persisted. The encrypted membership UUID works around the schema's
missing refresh context columns. Atomic compare-and-consume plus replacement
prevents reuse. Refresh never selects a different membership silently: a suspended
school or deactivated selected membership causes failure. Logout is idempotent.
Switch-school validates the requested school/role against actual active memberships
and returns a new pair; callers must replace their current pair. Previous pairs
represent independent sessions until logout/expiry/revocation; no nonexistent
token-family table or global logout is implied. Signing-key changes invalidate
access tokens; refresh encryption-key changes invalidate outstanding refresh tokens.

Memory accounts use the same JWT, bcrypt and guards. The browser demo membership
selector, arbitrary role headers and client schoolId bodies grant no API authority.

Ordinary school writes always derive schoolId from the validated actor. Platform
school management is explicit and does not grant access to individual academic
records. Cross-school/unavailable object IDs return 404. Parents first look up
their own VERIFIED links with no bypass, then enter the linked school's scope and
recheck link, active parent/student memberships, active users and school in the
read transaction. Authentication's narrowly bounded identity lookups are separate
from those parent academic operations. Parent child selection cannot grant access.

## Endpoints

All paths below have `/api/v1` prefix. Swagger remains `/api/docs`.

| Area | Endpoints / access |
| --- | --- |
| Auth | POST `/auth/login`, `/auth/refresh`, `/auth/logout`; authenticated POST `/auth/switch-school`; GET `/me` includes active role/membership and available active memberships |
| Platform schools | GET/POST `/admin/schools`; GET/PATCH `/admin/schools/:id` (Platform Admin). PATCH `{active:false}` suspends; true reactivates. |
| School administrator provisioning | POST `/admin/schools/:id/administrator` (Platform Admin only). Supply existing `{email}`, or new `{email,fullName,password,preferredLanguage?}`. Creates or reactivates only a SCHOOL_ADMIN membership in that explicit school, atomically with a new identity if needed; never overwrites an existing profile/password. |
| School identities | GET/POST `/users`, GET `/users/:id` (School Admin). POST creates a global identity plus initial school membership atomically. Existing email returns 409: use memberships instead. |
| Memberships | GET/POST `/memberships`, GET/PATCH `/memberships/:id` (School Admin). POST `{email,role}` attaches an existing active identity; PATCH only `{active}`. It never changes global User.active. |
| Own profile | PATCH `/me/profile` `{fullName?,preferredLanguage?}` for the authenticated identity. No email/password/global-active/role mass assignment. |
| Academics | GET/POST `/academic-years`, `/semesters`, `/grades`, `/sections`, `/subjects`, `/section-subjects`, `/enrollments`; GET/PATCH each `/:id`. Writes School Admin; reads School Admin, assigned Teacher or enrolled Student as appropriate. |
| Classes / rosters | GET `/teacher/classes`, `/teacher/classes/:id/roster` (Teacher); GET `/section-subjects/:id/roster` (School Admin or assigned Teacher); GET `/me/classes`, `/me/subjects` (Teacher/Student). IDs for classes are SectionSubject IDs. |
| Admin overview | GET `/school/academic-overview` (School Admin), derived counts and relationships. |
| Parent-link administration | GET/POST `/parent-links`, GET/PATCH `/parent-links/:id` (School Admin). POST `{parentId,studentId}`; PATCH `{status:"PENDING"|"VERIFIED"|"REJECTED"}`. REJECTED also implements revocation. |
| Parent reads | GET `/parent/children`; GET `/parent/children/:studentId/overview?schoolId=...` (Parent). School is derived from the verified link; optional schoolId only narrows it and never selects unauthorized data. |
| Health | Public GET `/health` is liveness + active driver; GET `/health/ready` checks storage and returns 503 on failure without exposing connection data. |

Lists return `{items,total,page,limit}`. Default page=1, limit=20; max limit=100,
max page=1,000,000. `search` max 200 characters, `sort=name|id`, `order=asc|desc`;
stable ID tie-breaking. Names use persisted names (relationship rows fall back to
ID); joined class/roster views search actual subject/section/person names. School
lists accept active=`true|false`; people/memberships accept active and school role
(active filters the school membership, not global identity state). Academic lists
accept sectionId/academicYearId and enrollment status; status on a model without
that field produces no matches. Parent-link lists accept LinkStatus. Filters run
after authorization; they never expand scope. Responses are bounded, but the
Phase 1 adapter loads school-scoped collections for relationship projections and
pagination. Query pushdown/index/performance work is required for production scale.

POST creates return 201, auth and administrator-provisioning POSTs 200, PATCH/GET 200, logout 204. Validation
errors are 400; unauthenticated/unavailable sessions 401; wrong operation role 403;
inaccessible records 404; uniqueness/history/concurrent conflicts 409.
Storage connection/pool/transaction availability failures use 503 when recognized;
they are not converted to invalid-credential responses by the authentication guard.
The error body is `{code,message,details?}`. SQL, hashes, raw exception data and secrets are not
returned or logged by the error handler. Do not log request authorization headers
or password/token bodies in a future reverse proxy.

Compatibility adaptations: schools/subjects lists are paginated envelopes rather
than raw arrays; subject hard deletion is removed; expired/old JWTs lacking the
new membershipId are rejected; old refresh tokens without encrypted membership
context cannot rotate and require login. Existing auth routes and token-pair/
login/me fields remain, with additive active context fields. No current frontend
uses these API paths for its demo, so its behavior is unchanged.

## Memory configuration and launch (not executed)

Required: Node/pnpm workspace dependencies, two distinct random secrets of at
least 32 characters, and a fictional development password (12 characters minimum,
at most 72 UTF-8 bytes). Never reuse real account credentials. Configuration rejects
production memory mode, missing/placeholder secrets, invalid TTLs, invalid CORS
origins and invalid Prisma-mode URLs. Access TTL accepts integer seconds or s/m/h,
60 seconds through 24 hours; refresh TTL is 1..90 days.

Copy `apps/api/.env.memory.example` to `apps/api/.env` and fill in the three blank
credential settings locally. Do not commit `.env`. Shell variables can be used
instead. Memory mode ignores DATABASE_URL/MIGRATION_DATABASE_URL.

From the nested pnpm workspace:

```powershell
cd D:\Desktop\Wasl\Wasl
corepack.cmd pnpm install --ignore-scripts
corepack.cmd pnpm --filter @wasl/shared build
corepack.cmd pnpm --filter @wasl/api dev:memory
```

`dev:memory` is a ts-node developer entry point and does not run Prisma generation
or require a generated client. The shared package build is needed because the
existing package points to `dist`. `--ignore-scripts` avoids dependency lifecycle
generation during installation. The existing `dev` command is still Nest watch;
the normal Prisma build workflow remains for the future database phase.
These are repository-script-derived commands for later execution, not commands
executed during this implementation. If Corepack is unavailable, use the existing
documented `npx.cmd --yes pnpm@10.28.0` equivalent.

Open `http://localhost:4000/api/docs`. Liveness is
`http://localhost:4000/api/v1/health`. Default CORS permits localhost:3000 in
development; set an explicit comma-separated allowlist for other web/Expo-web
origins. Native HTTP requests do not depend on browser CORS. Production has no
default origin allowlist and requires explicit configuration.

### Fictional accounts

All use the locally configured `WASL_DEV_PASSWORD` (bcrypt-hashed at bootstrap).

| Email | Role / school | User UUID suffix |
| --- | --- | --- |
| platform@wasl.test | Platform Admin, no school | 100 |
| admin1@wasl.test | School Admin, Al Nour | 110 |
| teacher1@wasl.test | Teacher, Al Nour | 111 |
| student1@wasl.test | Student Adam, Al Nour | 112 |
| admin2@wasl.test | School Admin, Al Amal | 120 |
| teacher2@wasl.test | Teacher, Al Amal | 121 |
| student2@wasl.test | Student Maya, Al Amal | 122 |
| parent@wasl.test | Parent with approved links and memberships at both schools | 130 |

UUID form is `00000000-0000-4000-8000-` plus the 12-digit padded suffix.
School suffixes are 1/2. Al Nour year/grade/section/subject/assignment/enrollment
suffixes are 400/402/403/404/405/406, and Al Amal 500/502/503/504/505/506.
No account list or plaintext-password inspection API is exposed. Prisma mode does
not create these accounts. No database seed was run or added by this phase.

## Focused manual checks (not executed)

Use Swagger or a separate API client. Keep tokens local; never paste real secrets
into screenshots, issue reports, shell history or logs.

1. Start memory mode with database URLs unset and no services. GET health and
   ready should report memory. Missing secrets and production memory mode should
   fail startup. Configure Prisma with an unreachable URL later and verify it
   fails rather than yielding memory records.
2. POST login with `{email:"admin1@wasl.test",password:"<your local value>"}`;
   check bearer `/me` contains school 1, SCHOOL_ADMIN and a membership UUID. Use
   mixed-case/space-padded email. Wrong password and unknown email both fail
   generically. Invalid/missing/tampered/expired access tokens fail.
3. Refresh twice using the same original token: exactly one should succeed,
   including concurrent requests. Refresh the returned replacement. Logout twice
   yields 204. Changing membership/school availability should invalidate access
   immediately and make refresh fail without selecting a different school.
4. As parent, switch from school 1 PARENT to school 2 PARENT; refresh must retain
   school 2. Attempts to switch to teacher, another identity's membership or
   nonexistent school fail. Login remains the recovery if the previously selected
   school/membership becomes unavailable.
5. As Platform Admin create/detail/edit/suspend/reactivate a school. Provision its
   initial School Admin through `/admin/schools/:id/administrator`, log in as that
   identity (or switch to the new membership), and use its academic endpoints.
   Existing identities are attached by email only and retain their credentials.
   Attempt ordinary users,
   rosters or academic content with that role and expect 403. Counts follow active
   user/membership records. Verify another role cannot manage platform schools.
6. As School Admin create a user and initial membership, retry duplicate email,
   attach the existing identity using `/memberships`, then deactivate/reactivate
   only that membership. Other-school memberships/global identity stay intact.
   Reject PLATFORM_ADMIN roles, schoolId, passwordHash, activeUser or ownership
   fields in bodies. Invalid compound writes must not leave orphan identities.
7. Create a year/semester/grade/section/subject/assignment/enrollment. Reject
   impossible dates, year-external semester ranges, duplicate unique relationships,
   an ineligible teacher/student, and every school-2 reference while acting in
   school 1. Cross-school GET/PATCH/detail/roster IDs should return 404, not leak a
   record. Duplicate subject codes and distinct overlapping semesters are permitted
   because the schema does not forbid them.
8. Teacher 1 sees class 405 and roster student 112, not class 505 or student 122.
   Student 1 sees only their own enrollment/classes/subjects. Enrolling a student
   in another section expands only that student's eligible academic read scope.
   Archiving a year hides it from current teacher/student views, preserving admin
   access/history. Withdrawn enrollment leaves current student class scope.
9. Parent sees Adam and Maya across schools. Revoke link 601 via admin1 using
   REJECTED; Adam's overview becomes unavailable, Maya remains. Wrong schoolId,
   arbitrary child IDs, inactive child memberships, suspended schools and pending
   links must not grant access. Reverify only eligible same-school relationships.
10. Check page bounds, invalid sort/filter names, unknown write fields and response
    payloads. No passwordHash/tokenHash/bypass or unrelated memberships appear.
    Restart memory server: mutations and sessions reset. Browser/native saved demo
    data must remain unchanged because the apps have not been connected.

## Verification limits and next phase

Only source and diff review was performed. No tests, builds, typechecks, Prisma
generation, database connections/provisioning/migrations/seeds, browser automation,
exports, commits, pushes or deployments were run. Memory behavior, API startup,
Prisma generated types/queries, SQL concurrency, constraints and RLS are unverified.
This is not a production-readiness claim. Existing future-scope database scripts
are not evidence that migrations, seed files or policies exist or have been run.

Next backend phase: scoped units/lessons/resources, question banks/assessments,
student drafts/submission, grading and explicit result release on this foundation.
Communication and frontend API integration follow their own approved scope.
