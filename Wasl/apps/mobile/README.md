# Wasl native mobile demo

Real React Native screens for School Admin, Teacher, Student and Parent, using the same platform-neutral demo model and operations as web. No WebView or Platform Admin mobile interface is included.

```powershell
cd D:\Desktop\Wasl\Wasl
npx.cmd --yes pnpm@10.28.0 install
npx.cmd --yes pnpm@10.28.0 --filter @wasl/mobile start
```

Use Expo Go on a compatible Android device, or run `npx.cmd --yes pnpm@10.28.0 --filter @wasl/mobile android` with an emulator/device configured. No APK was generated or native runtime verification performed.

The first screen is the demo school/membership selector. The first Teacher in a populated seed school has a mathematics class and seeded submissions. More exposes additional destinations and validated JSON file transfer. Native I18nManager direction changes may require a restart/reload; an in-app notice explains this, and current UI drafts/routes/filters are remembered locally.

See [the frontend guide](../../docs/frontend-demo.md) for workflows, safe persistence, transfer/migration behavior, manual checks and limitations.

Student/Parent workflows, demo accounts, v3 migration details and the end-to-end manual checklist are documented in [the Student/Parent guide](../../docs/student-parent-demo.md). No new packages were added for that extension. Full snapshot transfer remains an operator tool at demo entry or in staff workspaces.
