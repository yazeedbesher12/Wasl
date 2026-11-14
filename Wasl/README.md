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

## Getting started (current state)

Backend Phase 1 has development memory storage and implemented Prisma adapters.
The database is connected later; the existing web/native interfaces keep their
local demo behavior. See [the Phase 1 guide](docs/backend-phase1.md) for environment
settings, fictional accounts, endpoints and manual checks.

For a database-independent API, copy `apps/api/.env.memory.example` to
`apps/api/.env` and fill the required local development password and two distinct
random JWT secrets. Then, from this nested workspace:

```powershell
corepack.cmd pnpm install --ignore-scripts
corepack.cmd pnpm --filter @wasl/shared build
corepack.cmd pnpm --filter @wasl/api dev:memory
```

These are commands for later execution, not runtime verification performed during
implementation. Memory data resets on API restart and is refused in production.
Read [the database handoff](docs/database-handoff.md) before enabling Prisma mode.
Prisma generation, migrations, RLS and database behavior remain unverified.
The [frontend demo guide](docs/frontend-demo.md) covers the unchanged web/mobile
launch and snapshot workflows.
