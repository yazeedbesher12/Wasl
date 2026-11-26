# Release 1 verification

[Wasl verification](../../.github/workflows/wasl-verification.yml) runs on pull requests, pushes to `main` and `ci/**`, and manual dispatch. It uses GitHub-hosted Ubuntu 24.04, Node 24.14.0, and the workspace-pinned pnpm 10.28.0. Action versions are pinned to commits. Both jobs use read-only repository permissions and checkout without persisting credentials. The workflow uses no repository secrets.

## Verification matrix

Run the commands from the `Wasl/` workspace. Use `corepack pnpm` in place of `pnpm` if Corepack shims are unavailable.

| Coverage | Command | Resources |
| --- | --- | --- |
| Workspace install | `pnpm install --frozen-lockfile` | Registry and lockfile |
| Shared | `pnpm --filter @wasl/shared typecheck` and `pnpm --filter @wasl/shared build` | Shared build runs before consumers |
| API | `pnpm --filter @wasl/api build`, `pnpm --filter @wasl/api typecheck`, `pnpm --filter @wasl/api test` | Prisma client generation, Jest unit tests, in-process Nest HTTP tests with fictional memory storage |
| API authentication, mobile session races, parent files, throttling, uploads | Included in the full API Jest command | Uses the existing API test selection, including `native-session-race.spec.ts`, `parent-learning.memory.spec.ts`, `auth-rate-limit.spec.ts`, `files-communication.memory.spec.ts` and `object-store.spec.ts` |
| Web | `pnpm --filter @wasl/web typecheck`, `pnpm --filter @wasl/web lint`, `pnpm --filter @wasl/web build` | ESLint scans application source, including seven existing hook warnings. Next builds the production application |
| Web proxy | `pnpm --filter @wasl/web test:session` | Node test runner with simulated upstream and session families |
| Mobile | `pnpm --filter @wasl/mobile typecheck` | Expo TypeScript check |
| Browser setup | `pnpm --filter @wasl/web exec playwright install --with-deps chromium` | Browser and OS dependencies. Locally, `WASL_CHROMIUM_EXECUTABLE` can select an existing Chromium browser |
| Production web | `WASL_TEST_WEB_PRODUCTION=1 pnpm --filter @wasl/web test:integration` | Running Next production build, fictional memory API and Chromium. Covers roles, school switching, file transfer, session behavior, and isolated web process restart |
| Expo web | `pnpm --filter @wasl/web test:mobile` | Harness runs `expo export --platform web --max-workers 2`, serves the temporary export, and starts a fictional memory API and Chromium |
| PostgreSQL | `pnpm --filter @wasl/shared build`, `pnpm --filter @wasl/api exec prisma generate`, `pnpm ci:database` | Docker with a fresh loopback PostgreSQL 17 service |
| Dependency advisories | `pnpm ci:audit` | Reports full and production audit results. High or critical results and audit failures fail the job |
| Whitespace | `git diff --check` and a comparison against the event base or the last commit | Runs at repository root |

Browser harnesses allocate temporary ports, object storage, and generated credentials. The Expo export is tested in Chromium. An iOS or Android build and device behavior require separate verification.

### Disposable PostgreSQL

`pnpm ci:database` creates its own randomly named and labeled container, with PostgreSQL listening on 55436 internally and an automatically assigned loopback host port. The launcher accepts no database URL or port parameters. It rejects protected ports 5432 and 5433 and verifies the database name, migrator identity, PostgreSQL version, port and freshly generated marker via the host connection before running migrations. Cleanup targets only its own labeled container and volumes.

The container's privileged bootstrap/migration identity is distinct from the five restricted runtime logins. The subject verifier is non-login. The migrations install `pgcrypto` and configure the actual grants and policies. Fictional seed data and the proof key are inserted only after migration checks. The test processes receive restricted runtime URLs and a generated proof key. The migrator URL is excluded from their environment.

The launcher runs `prisma validate`, `prisma migrate deploy` twice, and `prisma migrate status`. It compares the complete successful database ledger with the exact SHA-256 hashes of the SQL files used on that checkout and verifies the ledger is unchanged after repeat deployment. From `apps/api` it invokes:

```text
node -r ts-node/register/transpile-only --test test/db-identity-boundary.cjs
node -r ts-node/register/transpile-only --test test/db-verified-subjects.cjs
node -r ts-node/register/transpile-only --test test/db-assessment-sensitive.cjs
```

Those suites check the marker and restricted role on the actual connections and cover DB-02 identity and session families plus DB-01 Subjects, assessment, academic, learning, files and directory isolation.

The original untracked files remain outside CI. `apps/api/prisma/seed.ts` writes a fixture to the legacy lab on 5433. `apps/api/test/prisma-lab.cjs` mutates fixtures in that same lab. `apps/api/test/prisma-security-audit.cjs` is read-only but still connects to that protected lab and checks the earlier privilege model. `docs/postgresql-tenant-security.md` describes historical findings and grants. The workflow has no dependency on any of these files.

## DEP-02 review

The full and production audit each returned six moderate advisories and one low advisory on 2026-11-26. The production dependency graph includes Expo CLI tooling even though Wasl app code does not call those packages directly.

| Advisory | Installed version and path | Applicability and update decision |
| --- | --- | --- |
| [GHSA-r3ph-w7gj-g6xm](https://github.com/advisories/GHSA-r3ph-w7gj-g6xm), moderate | `js-yaml@5.3.0` via production `@nestjs/swagger@11.4.7` | Affects YAML parsing. Wasl's Swagger route serializes its generated OpenAPI document. Swagger pins 5.3.0. Patched 5.4.1 is the same major but needs a Swagger update or an override and OpenAPI serialization regression coverage. |
| [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), moderate | `glob@13.0.6` via development `@nestjs/cli@11.0.24` and Expo's CLI/build tooling | Affects cancellation during filesystem traversal. Packages process project files at build time. No HTTP route passes request input to these CLI operations. Patched 14.0.2 crosses the major version required by the current CLI packages. |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), moderate | `minimatch@10.2.6` via the affected Nest and Expo `glob` paths | Affects costly pattern expansion. No Wasl request feeds patterns to these paths. Patched 11.0.1 crosses glob 13's declared minimatch range. Validate coordinated build-tool upgrades. |
| [GHSA-6889-vf6x-f3g5](https://github.com/advisories/GHSA-6889-vf6x-f3g5), low | `node-forge@1.4.2` via Expo CLI and Expo code-signing certificates | Affects Ed25519 signature verification. The installed Expo paths handle certificate and key tooling. No Wasl app verification path calls Forge Ed25519. Patch 1.4.3 fits the declared ranges. Verify Expo signing and native tooling before taking a targeted update. |
| [GHSA-w4xr-hqv8-ch44](https://github.com/advisories/GHSA-w4xr-hqv8-ch44), moderate | Same Expo Forge paths | Affects Forge's TLS client compression handling. Wasl uses platform HTTP clients and no direct Forge TLS client. Patch 1.4.3 fits the declared ranges and has the same tooling verification requirement. |
| [GHSA-6cv4-p8m7-4r25](https://github.com/advisories/GHSA-6cv4-p8m7-4r25), moderate | Same Expo Forge paths | Affects Forge's HTTP response header and cookie parsing. Wasl's API and clients have no direct Forge HTTP path. Patch 1.4.3 fits the declared ranges and has the same tooling verification requirement. |
| [GHSA-j8rw-jp99-435v](https://github.com/advisories/GHSA-j8rw-jp99-435v), moderate | Same Expo Forge paths | Affects Forge's TLS handshake handling. Wasl has no direct Forge TLS client. Patch 1.4.3 fits the declared ranges and has the same tooling verification requirement. |

No dependency versions changed. DEP-02 remains open for targeted updates through the owning packages and the corresponding build and signing regressions.

## External verification

GitHub job execution remains unverified until this workflow runs remotely. Native devices, a deployed private S3-compatible service, shared ingress rate limiting, shared web session state and a production-like migration rehearsal require staging evidence. The isolated web-process test checks that sessions from another process are rejected under the single-instance design.
