# Wasl web frontend

The web app includes the preserved Platform Admin interface at `/admin` and connected School Admin / Teacher / Student / Parent workspaces entered through `/demo`.

From the nested pnpm workspace root:

```powershell
cd D:\Desktop\Wasl\Wasl
npx.cmd --yes pnpm@10.28.0 install
npx.cmd --yes pnpm@10.28.0 --filter @wasl/web dev
```

Open http://localhost:3000/demo. No backend, database, shared-package build or credentials are required. The root URL continues to redirect to `/admin`.

See [the connected frontend guide](../../docs/frontend-demo.md) for all screens, native launch commands, demo accounts, shared data/migration details, snapshot transfer, dependency explanations, manual checks and verification limits. Existing browser data is upgraded safely; unreadable data is preserved and never silently reset. The explicit Platform Admin reset affects all connected school and teaching records.

This task received static review only; application code was not run, built, typechecked or tested.

Student/Parent workflows, demo accounts, v3 migration details and the end-to-end manual checklist are documented in [the Student/Parent guide](../../docs/student-parent-demo.md). No new packages were added for that extension. Full snapshot transfer remains an operator tool at demo entry or in staff workspaces.
