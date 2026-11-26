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

On 2026-11-26, the full and production audits each went from six moderate advisories and one low advisory to zero findings. The production dependency graph includes Expo CLI tooling. Its build and signing paths remain relevant even when the application has no direct calls to the affected functions.

| Advisory | Previous version and dependency path | Reachability and remediation |
| --- | --- | --- |
| [GHSA-r3ph-w7gj-g6xm](https://github.com/advisories/GHSA-r3ph-w7gj-g6xm), moderate | Transitive production `js-yaml@5.3.0` through direct `@nestjs/swagger@11.4.7` | Conditional parser exposure. The Swagger endpoint serializes Wasl's server-generated OpenAPI document. The inspected route accepts no YAML input. Fixed in 5.4.1. The same-major Swagger update to 11.4.8 resolves `js-yaml@5.5.0` with the existing Nest peer versions. |
| [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), moderate | Transitive `glob@13.0.6` through development `@nestjs/cli` and Expo CLI, config, config plugins, fingerprint, and Metro config in the mobile dependency graph | Conditional tooling exposure during filesystem traversal and cancellation. Build tools use globbing on project files. No API request path reaches these tools. Fixed in 14.0.2. The override targets the affected 13.0.6 resolution and crosses the declared glob major. |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), moderate | Transitive `minimatch@10.2.6` through the affected `glob` paths, Expo fingerprint, and development `@typescript-eslint/typescript-estree` | Conditional tooling exposure from pattern expansion. The build and lint paths use repository patterns. No Wasl request supplies patterns to them. Fixed in 11.0.1. The override and glob update converge on 11.0.9. That release requires Node 20 or 22+ and is exercised on the CI-pinned Node 24.14.0. |
| [GHSA-6889-vf6x-f3g5](https://github.com/advisories/GHSA-6889-vf6x-f3g5), low | Transitive `node-forge@1.4.2` through Expo CLI and Expo code-signing certificates in the mobile dependency graph | Ed25519 verification exposure was unverified in the Wasl toolchain. The inspected Expo certificate path uses X.509 and RSA. Patched 1.4.3 fits both parents' declared ranges and is pinned for the affected version. |
| [GHSA-w4xr-hqv8-ch44](https://github.com/advisories/GHSA-w4xr-hqv8-ch44), moderate | Same transitive Expo Forge paths | Forge TLS compression handling. No direct Wasl Forge TLS client was identified, and applicability through other native tooling remains unverified. Patched by 1.4.3. |
| [GHSA-6cv4-p8m7-4r25](https://github.com/advisories/GHSA-6cv4-p8m7-4r25), moderate | Same transitive Expo Forge paths | Forge HTTP response header and cookie handling. Wasl uses platform HTTP clients, and applicability through other native tooling remains unverified. Patched by 1.4.3. |
| [GHSA-j8rw-jp99-435v](https://github.com/advisories/GHSA-j8rw-jp99-435v), moderate | Same transitive Expo Forge paths | Forge TLS handshake handling. No direct Wasl Forge TLS client was identified, and applicability through other native tooling remains unverified. Patched by 1.4.3. |

Swagger also resolves `@microsoft/tsdoc@0.17.1`, `swagger-ui-dist@5.34.1`, and `argparse@3.0.4` through YAML. Glob resolves `path-scurry@3.0.0`, and minimatch adds `@isaacs/nonrecursive-glob-match@1.1.0`. React, Next.js, NestJS core and CLI, Prisma, Expo, and TypeScript stay on their existing versions.

Dependency smoke checks exercised Swagger's generated JSON and YAML documents and its UI asset, Expo project fingerprinting, and Expo's certificate helper with a throwaway RSA key. Native iOS and Android signing remain outside those checks. Retire the version-scoped overrides once compatible upstream tools resolve patched versions themselves.

## External verification

GitHub job execution remains unverified until this workflow runs remotely. Native devices, a deployed private S3-compatible service, shared ingress rate limiting, shared web session state and a production-like migration rehearsal require staging evidence. The isolated web-process test checks that sessions from another process are rejected under the single-instance design.
