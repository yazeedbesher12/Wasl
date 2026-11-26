import type { TokenPair } from '@wasl/shared';

export const sessionSelector = 'wasl-session-slot';
export const accessCookie = (slot: string) => 'wasl.access.' + slot;
export const refreshCookie = (slot: string) => 'wasl.refresh.' + slot;
const retryWindowMs = 5 * 60 * 1000;

type PendingLogout = {
  token: string;
  expires: number;
  operation?: Promise<boolean>;
};

export function createSessionState() {
  return {
    sessions: new Map<string, { expires: number; accessHash: string; refreshHash: string }>(),
    refreshing: new Map<string, Promise<TokenPair | null>>(),
    pendingLogout: new Map<string, PendingLogout>(),
  };
}
export type SessionState = ReturnType<typeof createSessionState>;

export async function revokeSession(
  state: SessionState,
  slot: string,
  token: string | undefined,
  revoke: (token: string) => Promise<boolean>,
): Promise<boolean | null> {
  state.sessions.delete(slot);
  let pending = state.pendingLogout.get(slot);
  if (pending && pending.expires <= Date.now()) {
    state.pendingLogout.delete(slot);
    pending = undefined;
  }
  if (token && !pending) {
    pending = { token, expires: Date.now() + retryWindowMs };
    state.pendingLogout.set(slot, pending);
    const entry = pending;
    setTimeout(() => {
      if (state.pendingLogout.get(slot) === entry) state.pendingLogout.delete(slot);
    }, retryWindowMs).unref();
  }
  if (!pending) return null;
  if (pending.operation) return pending.operation;
  const entry = pending;
  entry.operation = (async () => {
    let confirmed = false;
    try { confirmed = await revoke(entry.token); } catch {}
    if (confirmed && state.pendingLogout.get(slot) === entry) state.pendingLogout.delete(slot);
    entry.operation = undefined;
    return confirmed;
  })();
  return entry.operation;
}
