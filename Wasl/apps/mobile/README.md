# Wasl native

The default app uses real API accounts and records for all five roles. It reuses
the native UI/artwork, stores device tokens in SecureStore and uploads actual
files using DocumentPicker. Copy `.env.example` to `.env`, configure a reachable
API URL, build `@wasl/shared`, then run `pnpm --filter @wasl/mobile start`.

See [the integration guide](../../docs/frontend-api-integration.md) for phone/LAN
setup, role workflows, verification and device testing limits. Expo web tokens
are memory-only. The legacy local snapshot can be opened explicitly with
`EXPO_PUBLIC_WASL_MODE=demo`.
