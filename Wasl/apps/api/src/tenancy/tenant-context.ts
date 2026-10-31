import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request context used to scope every database query.
 * - schoolId: the active school; row-level security only shows its rows.
 * - userId: lets a user read their own memberships and parent links.
 * - bypass: only for trusted server code (login, platform admin, jobs).
 */
export interface TenantContext {
  userId: string | null;
  schoolId: string | null;
  bypass: boolean;
}

const storage = new AsyncLocalStorage<TenantContext>();

export const tenantStorage = storage;

export function currentTenant(): TenantContext | undefined {
  return storage.getStore();
}

export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Run trusted system code that must see all schools. Use sparingly. */
export function runAsSystem<T>(fn: () => T): T {
  return storage.run({ userId: null, schoolId: null, bypass: true }, fn);
}
