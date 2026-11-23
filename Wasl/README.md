# Wasl

Multi-school learning platform (graduation project, An-Najah National University, 2026-2027).
Students, teachers, parents, school admins and platform admins in one bilingual (Arabic/English) system with web, mobile, API and AI service.

- Design: [docs/design.md](docs/design.md)
- UML: [docs/uml/](docs/uml/)
- Next steps for development: [HANDOFF.md](HANDOFF.md)

## Layout

```
apps/api      NestJS + Prisma backend (PostgreSQL)
apps/web      Next.js web app
apps/mobile   Expo React Native app
apps/ai       FastAPI AI service (to be added)
packages/shared  shared TypeScript types and API client
infra/        docker-compose (to be added)
docs/         design and UML
```

## Files and communication backend update

The API supports real private file uploads/downloads, draft/published/archived
announcements and in-app notifications for publication, final submission and
released results. See [the file/communication guide](docs/backend-files-communication.md)
for upload contracts, role checks, local/S3 storage and the additive migrations.
Web and native screens now call these APIs. Live PostgreSQL/S3 verification remains separate.

## Assessment backend update

The API now implements units/lessons, resources/question banks, assignments/exams,
student answer drafts/final submissions, manual marking and explicit result release
for students and verified parents. See [the assessment API guide](docs/backend-assessments.md)
for contracts, permissions, lifecycle, verification and remaining database/file work.
Web/mobile default entry points now use real API sessions and records.

## Getting started (current state)

Backend Phase 1 has development memory storage and implemented Prisma adapters.
The database is connected later; web and native interfaces can use the real
API immediately through its memory adapter. Start with the
[frontend integration guide](docs/frontend-api-integration.md). See [the Phase 1 guide](docs/backend-phase1.md) for environment
settings, fictional accounts, endpoints and manual checks.

For a database-independent API, copy `apps/api/.env.memory.example` to
`apps/api/.env` and fill the required local development password and two distinct
random JWT secrets. Then, from this nested workspace:

```powershell
corepack.cmd pnpm install --ignore-scripts
corepack.cmd pnpm --filter @wasl/shared build
corepack.cmd pnpm --filter @wasl/api dev:memory
```

Memory data resets on API restart and is refused in production.
Read [the database handoff](docs/database-handoff.md) before enabling Prisma mode.
Prisma generation, migrations, RLS and database behavior remain unverified.
The [frontend demo guide](docs/frontend-demo.md) is historical for web (old
`/demo` bookmarks now redirect to login). Native snapshots remain available with
`EXPO_PUBLIC_WASL_MODE=demo`.
