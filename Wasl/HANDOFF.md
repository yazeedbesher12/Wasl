# Handoff prompt for the coding agent

Current implementation update: backend Phase 1 is now implemented with memory and
Prisma repository adapters; database connection and verification remain deferred.
The older scaffold/infra-first instructions below are historical. Start with
[docs/backend-phase1.md](docs/backend-phase1.md), the schema mapping and database
handoff linked there. Existing web/native demos remain intact. Do not run the old
seed/migration/test/commit sequence as part of the current static-review-only task.

Paste everything below the line into the agent in VS Code, with this folder open.

---

You are continuing my graduation project **Wasl** (An-Najah National University, Computer Engineering, 2026-2027). Wasl is a multi-school learning platform connecting students, teachers, parents, school admins and platform admins, with a web app, a mobile app, a backend API, a relational database and a separate AI service.

## Read these first
- `docs/design.md`: the full system design (scope and releases, roles and permissions, data isolation, database modules, API outline, offline sync, learning support, AI).
- `docs/uml/`: UML diagrams as Mermaid sources (`.mmd`) and PNGs: use case, class, three sequence diagrams, catch-up activity, assessment state machine, deployment.
- `apps/api/prisma/schema.prisma`: the Release 1 database schema.

## Decisions already made (do not change without asking me)
- Stack: pnpm workspaces + Turborepo monorepo; NestJS 11 + Prisma 6 + PostgreSQL 16 backend; Next.js 15 (App Router, Tailwind) web; Expo (React Native) mobile; Python FastAPI AI service; MinIO/S3 for files; Redis + BullMQ for jobs; Docker Compose; GitHub Actions CI.
- Interface is bilingual: Arabic and English, with full right-to-left support. Arabic is the default locale. Bilingual fields use `nameAr` / `nameEn`.
- Multi-school isolation: one shared database, `school_id` on every school-owned table, enforced in the API (school comes from the JWT, never from the client) AND by PostgreSQL row-level security. The API connects as a non-owner role `wasl_app`; migrations run as the owner `wasl`.
- Build order: Release 1 (core lesson-to-assessment workflow and parent view) first, then Release 2 (attendance, skill map, learning paths, catch-up plans, alerts), then Release 3 (offline sync, AI tutor and teacher AI drafts, portfolios).
- Design documents are in UML (my supervisor's format).
- Git repo: https://github.com/yazeedbesher12/Wasl (branch `main`).

## What is already done
- Root monorepo config: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.npmrc` (hoisted, for Expo), `.gitignore`, `.editorconfig`, `.env.example`.
- `packages/shared`: shared types (`Role`, `MeDto`, `LoginResponse`...) and a small typed `WaslClient` used by web and mobile. Builds with `tsc`.
- `apps/api` (NestJS), **typechecks cleanly but has not been run against a database yet**:
  - `prisma/schema.prisma`: all Release 1 tables (identity, academic structure, content, assessment, communication).
  - `src/tenancy/`: `AsyncLocalStorage` tenant context + `TenantInterceptor` that sets it from the JWT.
  - `src/prisma/prisma.service.ts`: Prisma client extension that wraps each query in a transaction which first runs `set_config('app.school_id' | 'app.user_id' | 'app.bypass_rls', ...)` for the RLS policies. Use `prisma.db` for queries.
  - `src/auth/`: login (bcrypt), rotating refresh tokens (hashed in DB), logout, switch-school, global `JwtAuthGuard` (`@Public()` to skip), `RolesGuard` (`@Roles(...)`), `@CurrentUser()`.
  - Controllers: `GET /api/v1/health`, `GET /api/v1/me`, platform admin `/api/v1/admin/schools`, and `/api/v1/subjects` as the first school-scoped resource.
  - Global validation pipe, CORS, unified error shape `{ code, message, details }`, Swagger at `/api/docs`.
- `apps/web`: fresh `create-next-app` scaffold (TypeScript, App Router, Tailwind, `src/`), renamed `@wasl/web`. No Wasl screens yet.
- `apps/mobile`: fresh `create-expo-app` blank TypeScript scaffold, renamed `@wasl/mobile`. No Wasl screens yet.

## What to do next (finish step 2, the skeleton), in this order
1. **Infra**: `infra/docker-compose.yml` with `pgvector/pgvector:pg16` (db `wasl`, owner `wasl`/`wasl`), an init SQL that creates the login role `wasl_app` / `wasl_app`, MinIO, and Redis. Make `pnpm install` + `docker compose -f infra/docker-compose.yml up -d` the setup.
2. **Migrations**: run `pnpm --filter @wasl/api exec prisma migrate dev --name init`. Then add a second migration `rls` that:
   - grants `SELECT, INSERT, UPDATE, DELETE` on all tables (and default privileges) to `wasl_app`;
   - enables and FORCEs row-level security on every table that has `school_id`, with a policy like `USING (current_setting('app.bypass_rls', true) = 'on' OR school_id::text = current_setting('app.school_id', true))` and the same `WITH CHECK`;
   - for `memberships` and `parent_student_links`, also allow rows where `user_id` / `parent_id` / `student_id` equals `current_setting('app.user_id', true)`;
   - leaves `users` and `refresh_tokens` without RLS (only reachable through server code).
3. **Seed** (`apps/api/prisma/seed.ts`): two schools ("Al-Nour School" and "Al-Amal School"), a platform admin, and per school: a school admin, two teachers, three students, one parent (one parent linked to children in both schools), one academic year, grades, sections, and a few subjects with Arabic and English names. Password for all: `Password123!`. Print the logins.
4. **Tests** (`apps/api/test/`, Jest + supertest against a real test database): login/refresh/logout, role guard, and a **cross-school isolation suite**: a school A admin cannot list, read, update or delete school B's subjects (expect 404, not 403, so existence is not leaked), and creating a subject always lands in the token's school. Also a test that queries through `prisma.db` with school A's context directly cannot see school B's rows (proves RLS works even if a controller forgets a filter).
5. **Web**: next-intl (or a simple dictionary) with `ar` and `en`, `<html dir="rtl">` for Arabic, a language switcher, a login page using `WaslClient`, and a role-based dashboard shell (sidebar per role, empty pages). Use `NEXT_PUBLIC_API_URL`.
6. **Mobile**: Expo Router, i18n with `I18nManager` RTL for Arabic, login screen using `WaslClient`, secure token storage (`expo-secure-store`), and placeholder tabs for students (Subjects, Tasks, Grades) and parents (Children). Use `EXPO_PUBLIC_API_URL`.
7. **AI service** `apps/ai`: FastAPI app with `GET /health` and stubbed `POST /tutor/ask` returning 501, `requirements.txt`, `Dockerfile`, pytest for health. Add it to docker-compose.
8. **CI** `.github/workflows/ci.yml`: on pull requests, start a Postgres service, `pnpm install`, build `@wasl/shared`, run migrations, typecheck all apps, run API tests, run AI pytest.
9. Update `README.md` with setup steps and the seeded logins, then commit and push to `main` in small commits.

After that, step 3 is Release 1 features, in this order: academic structure CRUD (years, grades, sections, enrollments, teacher assignment) → units and lessons with file upload via signed URLs → question banks and assessments → submissions and grading → results release → parent view → announcements and notifications. Every new school-scoped endpoint must get a case in the isolation test suite.

## Rules
- Never accept `school_id` from the client for school-scoped data; take it from the token.
- Every school-owned table must have `school_id` and an RLS policy.
- All user-facing text must exist in both Arabic and English.
- Keep `docs/design.md` and the UML in `docs/uml/` in sync when the design changes.
- Ask me before changing the stack or the data model in a big way.
