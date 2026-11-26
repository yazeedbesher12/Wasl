import { PrismaClient, type Prisma } from '@prisma/client';
import { createHmac } from 'node:crypto';
import type { StorageScope } from '../foundation/repositories';

/** Loaded only by Prisma storage. All queries in one operation share this transaction. */
export class PrismaService {
  readonly base: PrismaClient;
  constructor(url: string, private readonly subjectKey?: Buffer) { this.base = new PrismaClient({ datasources: { db: { url } } }); }
  async connect(role: 'wasl_auth' | 'wasl_platform' | 'wasl_tenant' | 'wasl_academic_admin' | 'wasl_assessment_staff') {
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
      if (scope.subjects || scope.assessment) {
        if (!this.subjectKey || !scope.userId || !scope.schoolId) throw new Error('Transaction scope issuer unavailable');
        const [{ database, backend, transaction, login }] = await tx.$queryRaw<{
          database: string; backend: string; transaction: string; login: string;
        }[]>`
          SELECT oid::text AS database, pg_backend_pid()::text AS backend,
            pg_current_xact_id()::text AS transaction, session_user::text AS login
          FROM pg_catalog.pg_database WHERE datname = current_database()`;
        const binding = [database, backend, transaction, login, Date.now() + 15000, scope.userId];
        if (scope.subjects) {
          const { access, membershipId } = scope.subjects;
          const proof = JSON.stringify([...binding, membershipId, scope.schoolId, access.operation,
            access.operation === 'read' ? null : access.subjectId, access.operation === 'read' ? access.childId ?? null : null]);
          const tag = createHmac('sha256', this.subjectKey).update(proof).digest('hex');
          await tx.$queryRaw`SELECT set_config('app.subject_proof', ${proof}, true) IS NOT NULL,
            set_config('app.subject_tag', ${tag}, true) IS NOT NULL`;
        }
        if (scope.assessment) {
          const { membershipId, operation, targetId } = scope.assessment;
          const proof = JSON.stringify([...binding, membershipId, scope.schoolId, `assessment:${operation}`, targetId]);
          const tag = createHmac('sha256', this.subjectKey).update(proof).digest('hex');
          await tx.$queryRaw`SELECT set_config('app.assessment_proof', ${proof}, true) IS NOT NULL,
            set_config('app.assessment_tag', ${tag}, true) IS NOT NULL`;
        }
      }
      return work(tx);
    }, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 });
  }
}
