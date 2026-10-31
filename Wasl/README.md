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

```bash
pnpm install
cp .env.example .env
pnpm --filter @wasl/shared build
pnpm --filter @wasl/api exec prisma generate
pnpm --filter @wasl/api typecheck
```

A database, migrations and seed data come next (see HANDOFF.md).
