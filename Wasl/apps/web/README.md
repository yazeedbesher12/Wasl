# Wasl web

The default entry redirects to `/login`. All five role workspaces use actual API
sessions, records and private file transfers. Copy `.env.example` to `.env.local`
and configure the server-only API URL, build `@wasl/shared`, then run
`pnpm --filter @wasl/web dev` from the nested workspace.

See [the integration guide](../../docs/frontend-api-integration.md) for fictional
API accounts, setup, supported workflows, session deployment constraints and tests.
Old `/demo` bookmarks redirect to authenticated login. Previous local snapshots
remain untouched and do not participate in API operations.
