# Database connection handoff — Phase 1

No database was provisioned or connected in this phase. The existing Prisma 6.9.0
PostgreSQL schema, enum values, SQL mappings, UUIDs and nullability were preserved.
The implemented adapter is source code awaiting database-backed verification,
not proof that constraints, migrations, RLS or runtime queries work.

## What is implemented

`StorageModule` selects `WASL_STORAGE_DRIVER=memory|prisma` by Nest injection.
`PrismaStorage` implements the same repository methods as `MemoryStorage`:

- User lookup/create/owner-profile update; active membership lookup;
  hashed refresh lookup/create/conditional consumption/revocation.
- School catalog CRUD without deletion; active student/teacher aggregates.
- School membership list/create/activation; teacher/student eligibility.
- Scoped list/detail/create/update for AcademicYear, Semester, Grade, Section,
  Subject, SectionSubject, Enrollment.
- Parent link list/create/status updates and exact own VERIFIED-link lookup.

Controllers and services do not branch by storage mode. Prisma uses one transaction
per complete operation, including authorization checks, tenant settings and compound
writes. Transaction isolation is Serializable with maxWait=5s / timeout=10s; P2034
retries the complete operation up to three times. Refresh rotation uses an
updateMany conditional on null revokedAt and unexpired expiresAt, checks count=1,
and creates the replacement in the same transaction. User creation and initial
membership likewise share a single transaction. No raw request filter or sort
field becomes an ORM identifier.

The old per-statement Prisma extension has been replaced. Future repository code
must use the passed `tx`; never use `base` or open another transaction inside a
service operation. `base` is reserved for connection lifecycle and readiness.

## Environment

Start from `apps/api/.env.prisma.example`, not the memory template. All values below
are placeholders, not credentials:

```dotenv
NODE_ENV=development
WASL_STORAGE_DRIVER=prisma
DATABASE_URL=postgresql://runtime_user:runtime_password@database-host:5432/wasl?sslmode=require
MIGRATION_DATABASE_URL=postgresql://migration_user:migration_password@database-host:5432/wasl?sslmode=require
JWT_ACCESS_SECRET=<distinct-random-secret-at-least-32-characters>
JWT_REFRESH_SECRET=<another-random-secret-at-least-32-characters>
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL_DAYS=30
API_PORT=4000
CORS_ORIGINS=https://your-web-origin.example
```

DATABASE_URL is the non-owner application login with the minimum required table/
sequence/function privileges. It must not be a superuser, owner or BYPASSRLS role.
MIGRATION_DATABASE_URL is a separate direct connection for migration privileges;
it is the Prisma datasource's existing directUrl convention and is never used by
the API's query adapter. The future migration role owns/changes schema. Do not
place either URL or JWT secret in NEXT_PUBLIC/EXPO_PUBLIC variables.

For local PostgreSQL choose appropriate local TLS settings. For hosted PostgreSQL,
confirm provider TLS, network access, pool/direct endpoint and connection limits.
An application pooler must support interactive transactions and transaction-local
set_config values without leaking settings between requests. Use a direct endpoint
for migrations; verify prepared-statement/pooler compatibility with Prisma 6.9.0.
No particular hosting provider, connection or infrastructure was selected here.

Prisma mode validates both URL formats and connects explicitly. Connection or
configuration failure aborts startup; it never returns the fictional memory data.
Once running, `/health` is liveness and `/health/ready` reports storage failures.
Do not claim a successful SELECT 1 proves tenant policies or permissions.

## Remaining database work, in order

1. Approve a PostgreSQL host and provision it outside this task. Inventory actual
   database contents first. Plan backups and migration baselines for existing data.
2. Review [schema gaps](backend-schema-mapping.md). Any new contact/location,
   archive, preferences, link-history, session or composite constraint changes need
   explicit approval and a real migration. Do not put frontend snapshots into an
   invented JSON column. Review email normalization/case duplicates before adding
   identities to an existing database.
3. Create/review migration history for the existing schema using the separate
   migration role. Existing package scripts are entry points, not evidence that
   migration/seed files have been implemented or validated. Inspect the files
   before running anything. Do not reset a populated schema to match fixtures.
4. Add and verify database integrity: teacher/student User references where absent,
   School references where absent, consistent same-school composite references,
   parent/student role eligibility where appropriate, nullable PLATFORM_ADMIN
   uniqueness and link-pair history decisions. Keep API checks as well.
5. Design RLS and least-privilege grants for every school-owned table. Ordinary
   operations set `app.school_id`, `app.user_id`, `app.bypass_rls=off`. Parent
   operations ALWAYS keep bypass off. Own VERIFIED link discovery must work with
   no selected school; linked-child reads must validate the verified link, active
   child/parent memberships and school, not merely a client-supplied school ID.
6. Carefully scope supporting identity reads: auth uses exact user/email/hash
   lookups with internal `identity` scope; only explicit platform school management
   uses `platform` scope. These narrowly privileged operations currently set
   app.bypass_rls=on within their transaction. Do not grant arbitrary parent or
   request-based bypass. Consider security-definer functions/a restricted identity
   connection in the database phase rather than a broad table policy. Review how
   global User/RefreshToken lookup and School availability are exposed internally.
7. Supporting non-bypass policies must permit the exact reads the service needs:
   an actor's own active memberships across schools; that actor's selected school
   availability; eligible membership/user lookup inside the target school; a
   parent's own verified links across schools, then only approved linked child's
   eligible academic rows. Read restrictions must not accidentally hide a
   uniqueness or eligibility conflict and let a write bypass application checks.
   ParentStudentLink has no School relation and Enrollment.studentId lacks a User
   relation, so do not assume Prisma includes can perform these checks automatically.
8. Verify transaction context and policies using the non-owner runtime role,
   including FORCE ROW LEVEL SECURITY where appropriate. A table owner or broad
   bypass policy would invalidate the isolation review. Test no tenant values
   survive a committed/rolled-back transaction or leak through the pool.
9. Generate the Prisma client for the unchanged pinned 6.9.0 dependency, then run
   the separately authorized build/typecheck/database checks. Adapt generated
   input types if needed; never work around them by changing the schema or using
   raw unscoped clients. No client generation was run during this task.
10. Implement and review a separate database bootstrap/seed/provisioning process
    with normalized emails, bcrypt hashes, active memberships and valid UUID
    relationships. The runtime Prisma adapter does NOT seed accounts. Do not run
    or depend on the memory bootstrap or embed development passwords in production.
11. Exercise the manual API checks in [Phase 1](backend-phase1.md) against PostgreSQL,
    and add/run future authorized concurrency, constraint, RLS and cross-school
    verification. Include simultaneous refresh consumption, duplicate email and
    membership creation, rollback, concurrent suspension/assignment, parent
    revocation, connection failures and the real migration/runtime roles.
12. Only then enable Prisma mode for a real environment. Verify CORS, HTTPS, token
    handling, login abuse protection/rate limiting, secure client token storage,
    logging/redaction, backups, monitoring and operational key rotation before a
    production deployment. These operational controls were not claimed in Phase 1.

Future commands, intentionally NOT executed here:

```powershell
cd D:\Desktop\Wasl\Wasl
corepack.cmd pnpm --filter @wasl/api exec prisma generate
corepack.cmd pnpm --filter @wasl/shared build
# After the reviewed migrations, permissions, policies and bootstrap exist:
corepack.cmd pnpm --filter @wasl/api dev
```

Migration and seed commands must be selected after inspecting the real database
and actual migration files; no db push/reset/generic seed command is a safe
substitute for that review.

## Future frontend adapter

`WaslClient` takes base URL including `/api/v1` and a token getter. New typed
methods cover every Phase 1 operation, and `foundation.ts` exports public DTOs.
Leave the existing demo repository in place until integration is explicitly
authorized. A future API-backed repository should map these DTOs to screen view
models, not overwrite browser/native snapshots or send generic `DemoRecord.values`.
Use API UUIDs as separate identities; importing old browser fixture IDs is not an
automatic migration. Fetch current actor/memberships from `/me`, not the demo
switcher. Replace stored token pairs after refresh or switch; handle 401/404
availability changes and apply bilingual presentation at the client boundary.
Use paginated envelopes, explicit date-only strings and real schema lifecycle
states. Unsupported frontend fields/controls need the documented schema decisions,
not fake successful writes. Content/assessment/result routes remain future work.
