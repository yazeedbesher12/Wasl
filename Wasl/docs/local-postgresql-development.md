# Persistent local PostgreSQL 17 development

This environment is separate from PostgreSQL 18 on port 5432, the legacy lab on
5433, and the disposable CI database. It uses the Compose project
`wasl-postgres17-dev`, loopback port 55437 by default, and the named volume
`wasl_postgres17_dev_data`. Normal shutdown preserves the volume.

## One-time private configuration

From the `Wasl` workspace root:

Generate a private file with independent random values:

```powershell
corepack pnpm db:dev:configure
```

Alternatively, copy `.env.postgres.example` to `.env.postgres.local` and fill it
manually.

Fill every empty value in `.env.postgres.local`. Database passwords and the
fictional administrator password must be 48 lowercase hexadecimal characters.
The proof and JWT keys must be 64 lowercase hexadecimal characters. Generate
each value independently; never reuse the proof or JWT keys. One PowerShell
example for a 32-byte key is:

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
```

The local file is ignored by Git. Do not add it to source control.

## Start and bootstrap

```powershell
corepack pnpm db:dev:up
corepack pnpm db:dev:bootstrap
```

The first command starts only the persistent PostgreSQL 17 container. On a new
volume its entrypoint creates the five restricted login roles and the non-login
verifier. The second command refuses any unmarked target, validates and generates
the Prisma client, applies all migrations, verifies migration status, installs
the protected proof key without replacing a different existing key, and runs the
idempotent development seed.

The fictional login is `platform-admin@wasl.local`; its password is the private
`WASL_DEV_ADMIN_PASSWORD` value. The seed refuses an existing account that does
not exactly match the expected active platform membership and password.

Run the API in Prisma mode in a separate terminal:

```powershell
corepack pnpm db:dev:api
```

The command derives all five restricted runtime URLs in memory and does not put
the migration credential into the API process. API readiness is available at
`http://127.0.0.1:4000/api/v1/health/ready`.

## Stop, restart, and inspect

Stop the API with `Ctrl+C`. Stop PostgreSQL while preserving all data:

```powershell
corepack pnpm db:dev:down
```

Start the same database again with `corepack pnpm db:dev:up`. Re-running
`db:dev:bootstrap` is safe when secrets and the seeded account are unchanged.
Run bootstrap before starting the API. On Windows, stop the API before
re-running bootstrap because the live Node process locks Prisma's engine DLL.
Follow database logs with:

```powershell
corepack pnpm db:dev:logs
```

`db:dev:down` intentionally does not pass `--volumes`. Removing the named volume
is a destructive reset and is not provided as a package script.

## Security and operating notes

- The host binding is loopback-only. Do not change it to `0.0.0.0`.
- Keep the migration owner out of the API runtime.
- Changing database-role passwords requires a reviewed rotation; changing the
  env file alone does not alter roles in an existing volume.
- A different proof key is rejected for an existing database rather than silently
  replacing it.
- Local file bytes are stored under `.wasl-data/postgres-dev-files`; metadata is
  persisted in PostgreSQL. Production still requires private S3-compatible storage.
- Apply existing migrations with `db:dev:bootstrap`; do not use `db push`, reset,
  or `migrate dev` against this persistent environment.
