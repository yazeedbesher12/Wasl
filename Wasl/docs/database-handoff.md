# Database connection handoff — Phase 1

**File/communication update:** additive FileObject metadata and announcement
status/publishedAt are now in the Prisma schema. Initial baseline and feature
migration SQL are supplied under `apps/api/prisma/migrations`; the feature includes
RLS for files, announcements and notifications. They have not been applied to a
live PostgreSQL database. Earlier instructions describing an unchanged schema or
absent migration history are historical. Existing databases need schema comparison
and deliberate baselining before these migrations; never reset existing data.
See [the current guide](backend-files-communication.md).

**Subsequent backend update:** the existing schema now also has implemented
content, question-bank, assessment, submission/answer and grading/release adapters.
See [the assessment guide](backend-assessments.md). Prisma client generation,
TypeScript checking and API memory tests were performed in that update; live
PostgreSQL migrations, grants, RLS and concurrency are still unverified. The
Phase 1-only operation list and historical non-execution statements below refer
to that earlier phase.

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
DATABASE_URL=postgresql://wasl_tenant:tenant_password@database-host:5432/wasl?sslmode=require
AUTH_DATABASE_URL=postgresql://wasl_auth:auth_password@database-host:5432/wasl?sslmode=require
PLATFORM_DATABASE_URL=postgresql://wasl_platform:platform_password@database-host:5432/wasl?sslmode=require
JWT_ACCESS_SECRET=<distinct-random-secret-at-least-32-characters>
JWT_REFRESH_SECRET=<another-random-secret-at-least-32-characters>
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL_DAYS=30
API_PORT=4000
CORS_ORIGINS=https://your-web-origin.example
```

For `202611260001_db_identity_boundary`, have the database administrator create
the three named logins with distinct secrets, no memberships, and `NOSUPERUSER`,
`NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE` and `NOREPLICATION`. The database owner
applies the migration, which grants the specific rights below and revokes legacy
`wasl_app` database and table grants. Provision the application URLs alongside a
coordinated cutover from the old login. Set `MIGRATION_DATABASE_URL` in the separate
Prisma CLI environment using the database owner and a direct endpoint. The API
rejects this variable in Prisma mode. Keep all database URLs and JWT secrets
server-side.

| Runtime role | Granted access and trust |
| --- | --- |
| `wasl_tenant` | Reads profile columns, memberships and schools for application authorization. Writes tenant feature data through the tenant repositories. The role has no credential, refresh-token or identity administration grants. |
| `wasl_auth` | Reads profile, credential, membership and school data for login and session checks. Inserts refresh rows and updates only their revocation timestamps. Compromise of this credential exposes password and refresh hashes. |
| `wasl_platform` | Reads non-secret identity data, creates identities and updates profile fields, manages schools, and writes school memberships through `wasl_admin.school_memberships`. The view rejects platform memberships. The API is trusted to validate which actor may administer each school. Compromise of this credential permits school identity administration across schools. |

School-admin identity writes use the administration connection for the entire
Serializable operation, including rechecking the actor and writing the user and
membership. The tenant login has no access to the administrative schema. Custom
settings remain untrusted. DB-01 still requires database-enforced school scoping
for ordinary tenant records and identity profile reads.

### Subjects isolation prototype

The two additive Subjects migrations protect the authorization inputs and enable
forced RLS on `subjects`. The administrator provisions `wasl_academic_admin`
as a restricted non-owner login with no role memberships, and
`wasl_subject_verifier` as a restricted `NOLOGIN` role. The migrator needs
permission to transfer ownership of the verifier function to that role. The
database needs `pgcrypto` in the protected schema installed by the migration.
The academic-administration connection handles year, grade, section, assignment,
enrollment, and parent-link writes after the API rechecks the school administrator
within the same transaction. It uses `ACADEMIC_ADMIN_DATABASE_URL`.

Give the trusted API a separate 32-byte `WASL_SUBJECT_PROOF_KEY` through the secret
store. Provision the same key into `wasl_subject_scope.signing_key` through a
protected administrator connection. Use a different key per database deployment
and from either JWT key. The tenant login cannot read the key table, use the
crypto schema, or assume the verifier or academic-administration identity. This
prototype uses one active key and needs a coordinated key rotation procedure.

The API signs a typed operation for the authenticated actor against the pinned
Prisma transaction. The verifier checks the HMAC, runtime login, database OID,
backend PID, full transaction ID, expiration, active account and membership,
school, and operation. It checks teacher assignment, student enrollment, or
the specific verified parent-child link for reads. Insert and update proofs
cover one subject ID. There is no delete policy. Custom settings only carry
the proof and tag. They confer no authority without independent verification.

The proof expires after 15 seconds. Even a captured valid proof cannot be used
on another connection or in the next transaction on a reused connection.
Serializable retries get a fresh binding. A proof is reusable within its own
transaction for its existing scope, so the design assumes that any SQL running
inside an authorized transaction can use that transaction's exact capability.
The NestJS process and the database owner remain trusted. This prototype has no
independent issuer security boundary against compromise of the API process.

Other tenant tables still need their own scoped policies. In particular, the
tenant grants on learner metadata and existing file and communication policies
still need review. The prototypes below are for disposable lab verification.

### Assessment sensitive-column prototype

| Relation and fields | Intended read and write access | Boundary in this prototype |
| --- | --- | --- |
| `questions` and `question_banks` prompt, points, owner and subject | Staff authoring and assignment-aware learner delivery | Tenant retains metadata reads. The staff connection owns API writes. Authoring validates ownership. |
| `question_options.is_correct`, `question_options.text` | Authors read and replace keys. Learners receive multiple-choice and true/false option labels. Short-answer option text is an accepted answer. | Tenant has no base-table grant. The learner view omits correctness and filters short-answer rows. Staff authoring uses the base table. |
| `assessment_questions` links and ordering | Staff attaches eligible questions. Learners use links for an assigned assessment during delivery. | Tenant retains link reads. Staff alone changes links. Submission RLS checks that an inserted answer references an attached question. |
| `assessments.status`, `opens_at`, `due_at`, `results_released_at` | Learners check delivery and release state. Assigned teachers manage transitions. | Tenant reads metadata. The staff role controls state writes. The released-grade command checks persisted release state. |
| `submissions.score`, `feedback`, `graded_at`; `answers.score` | Staff reads and writes grades. Students and verified parents receive only released results. | Tenant raw reads and writes are revoked. The release command verifies proof, enrollment, recipient and release state. |
| `submissions` identity, status and timestamp; `answers.response`, `file_key` | Students submit their own work. Assigned staff reads submissions for grading. | Tenant reads non-grade columns and writes only authorized open drafts through verified write policies. Raw cross-school reads of these non-grade columns remain a DB-01 gap. |
| `users.password_hash`; `refresh_tokens.token_hash` and session lifecycle | Authentication uses verifier and session data. Provisioning writes a new password verifier through DB-02. | Existing auth and platform grants remain separate. Tenant reads only profile columns and has no refresh grants. |
| `memberships` assignments, active state and role | Scoped API eligibility and administrator lifecycle management | Existing DB-02 read and write boundaries remain. Raw tenant membership visibility still requires DB-01 work. |
| `file_objects` storage key, owner, filename and metadata | Authorized upload and download workflows and assessment attachment validation | Existing grants and policies remain. The assessment prototype does not change storage access. |
| `notifications` recipient, student and entity IDs, payload and read status | Originating actions create messages. Recipients read or mark them. | Existing tenant grants and school policy remain. Staff assessment transitions can insert notifications in the same transaction. |
| `schools` profiles and `parent_student_links` identities, verification state and time | Platform manages schools. Authorized school administrators verify links. | School writes stay with platform. Link writes stay with the academic-admin provider. Raw profile and relationship reads need DB-01 scoping. |
| `academic_years`, `semesters`, `grades`, `sections`, `subjects`, `section_subjects`, `enrollments` | Staff manage school structures, teacher assignments and enrollment. Learners and parents read class information relevant to them. | Subject RLS and protected authority writes remain. Other school data and student enrollment reads need DB-01 scoping. |
| `units`, `lessons`, `resources`, `announcements` content, publication state, URLs and storage references | Staff author and publish. Learners and parents receive eligible published content. | Existing grants and response rules remain. Draft visibility and direct tenant SQL access still need DB-01 scoping. |

Provision `wasl_assessment_staff` as a restricted non-owner login with no role
memberships and pass `ASSESSMENT_STAFF_DATABASE_URL` to the API. The API trusts
this credential for authoring and grading and rechecks the authenticated actor's
role, school and assignment in the same Serializable transaction. Keep the staff
credential out of learner or tenant SQL sessions. It can query sensitive fields
across schools if the trusted credential itself is compromised.

Participation and released-grade proofs are distinct from Subjects proofs. Draft
and final-submission proofs bind separate operations to one assessment. A results
proof binds to a student or verified child. They use the same short-lived
transaction binding. The verifier cannot mint proofs. Its release command returns only a released grade
and scoped answer scores after independent verification. A proof remains usable
for its exact purpose until expiration or transaction end. Existing learner DTO
nulls and omitted correctness fields are preserved by safe database projections.

### Verified learner and assessment rows

The pre-migration catalog audit found the following effective grants for
`wasl_tenant`. A column grant still permits ordinary SQL and joins where RLS
allows the row.

| Relation | Baseline tenant grants | Verified scope in `202611260005` |
| --- | --- | --- |
| `question_options` | No base grants. The safe view exposed labels from every school. | The safe view requires eligible delivery of the question. Staff base-table policies require authoring or assigned assessment access. |
| `questions`, `question_banks` | Table SELECT, with no RLS. | Staff authoring is scoped by subject assignment or school-admin membership. Learner metadata is visible only through an eligible opened assessment. |
| `assessments`, `assessment_questions` | Table SELECT, with no RLS. | Verify class assignment or active enrollment. Learners can read scheduled assessment metadata while prompts, option labels, and link rows wait until opening. Question totals use a scoped aggregate. |
| `submissions` | Non-grade column SELECT, limited INSERT and UPDATE. SELECT policy allowed every row. | Verify ownership or an assigned staff relationship. Parent reads require the exact verified child and published results. Draft writes keep their original rules. |
| `answers` | Non-score column SELECT, limited INSERT and DELETE. SELECT policy allowed every row. | Verify the parent submission and participant. Notification metadata proofs confer no answer access. Staff grading binds to one submission. |
| `parent_student_links` | Table SELECT for the tenant and trusted staff. | Parent discovery returns only the parent's verified active links. Teachers can read links for students in their assigned classes when resolving notification recipients. The academic-admin role still manages links and is trusted. |

The migration reuses the signed assessment transaction proof and the existing
non-login verifier. Separate read, metadata, parent discovery, authoring, and
grading purposes narrow the rows that the credential can see. A grading proof
is bound to one submission. It can set its assessment to `GRADING` and update
marks, but cannot publish the results or redirect a submission. Application
authorization and Serializable retries remain in the same execution path.
Parent-link revocation takes effect on subsequent transactions. The database
owner, verifier ownership boundary, and API signing process remain trusted.

### Verified academic, content, file, and communication data

The academic migration limits roster reads to enrolled students, assigned
teachers, and the selected verified child. School admins use a separate
academic-write proof, and foreign keys include the school ID for terms,
sections, assignments, and enrollments. The content migration scopes units,
lessons, and resources to the class, with published-only learner access. Staff
content writes require an open year and an authoring proof. The file and
communication migration replaces all three caller-set school policies with
verified proofs. File uploads bind to an exact lesson or assessment and the
owner's storage namespace. Notification writes verify the real event and its
recipient, and read receipts update only the recipient's scoped row.

| Prisma tables | Classification and remaining trust |
| --- | --- |
| `academic_years`, `semesters`, `grades`, `sections`, `section_subjects`, `enrollments`, `subjects` | Verified school and relationship scope. Academic writes use the restricted admin role. |
| `units`, `lessons`, `resources`, `question_banks`, `questions`, `question_options` | Verified assignment, open-year authoring and publication scope. The base option table stays unavailable to learners. |
| `assessments`, `assessment_questions`, `submissions`, `answers` | Verified subject assignment, participant and release scope. Separate column grants protect grades and keys. |
| `parent_student_links`, `memberships` | Verified school and relationship scope for tenant-side reads. Auth and platform retain restricted identity-management paths. |
| `file_objects`, `announcements`, `notifications` | Verified owner, audience or recipient access. The object store remains private. |
| `refresh_tokens` | Privileged auth operations. The tenant role has no access. |
| `users`, `schools` | Remaining DB-01 gap. Tenant profile columns and school metadata are still readable without a verified school scope. Password hash access remains restricted by DB-02. |

DB-01 remains open until the profile and school metadata boundary is resolved.
The API proof issuer, database owner and non-login verifier remain trusted.
The composite foreign keys are enforced by additive PostgreSQL migrations.
Check existing data for inconsistent school references before rollout so the
new constraints can be validated without rewriting data.

For local PostgreSQL choose appropriate local TLS settings. For hosted PostgreSQL,
confirm provider TLS, network access, pool/direct endpoint and connection limits.
An application pooler must support interactive transactions and transaction-local
set_config values without leaking settings between requests. Use a direct endpoint
for migrations; verify prepared-statement/pooler compatibility with Prisma 6.9.0.
No particular hosting provider, connection or infrastructure was selected here.

Prisma mode validates the runtime URLs and checks their login identities. Connection or
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
