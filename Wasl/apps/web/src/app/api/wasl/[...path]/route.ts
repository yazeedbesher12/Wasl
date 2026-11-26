import { createWaslProxy } from '../proxy';
import { createSessionState, type SessionState } from '../session-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const host = globalThis as typeof globalThis & { waslProxySessions?: SessionState };
const handle = createWaslProxy(host.waslProxySessions ??= createSessionState());

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
