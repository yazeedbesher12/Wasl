import { PrismaClient, type Prisma } from '@prisma/client';
import type { StorageScope } from '../foundation/repositories';

/** Loaded only by Prisma storage. All queries in one operation share this transaction. */
export class PrismaService {
  readonly base: PrismaClient;
  constructor(url: string) { this.base = new PrismaClient({ datasources: { db: { url } } }); }
  async connect(role: 'wasl_auth' | 'wasl_platform' | 'wasl_tenant') {
    const [identity] = await this.base.$queryRaw<{ valid: boolean }[]>`
      SELECT current_user::text = ${role} AND session_user::text = ${role}
        AND NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = pg_roles.oid)
        AND NOT pg_catalog.pg_has_role(current_user, datdba, 'MEMBER') AS valid
      FROM pg_catalog.pg_roles CROSS JOIN pg_catalog.pg_database
      WHERE rolname = current_user AND datname = current_database()`;
    if (!identity?.valid) throw new Error(`Invalid PostgreSQL execution identity for ${role}`);
  }
  async close() { await this.base.$disconnect(); }
  async transaction<T>(scope: StorageScope, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.base.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.school_id', ${scope.schoolId ?? ''}, true), set_config('app.user_id', ${scope.userId ?? ''}, true), set_config('app.bypass_rls', 'off', true)`;
      return work(tx);
    }, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 });
  }
}
