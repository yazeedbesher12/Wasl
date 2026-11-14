import { PrismaClient, type Prisma } from '@prisma/client';
import type { StorageScope } from '../foundation/repositories';

/** Loaded only by Prisma storage. All queries in one operation share this transaction. */
export class PrismaService {
  readonly base: PrismaClient;
  constructor(url: string) { this.base = new PrismaClient({ datasources: { db: { url } } }); }
  async connect() { await this.base.$connect(); }
  async close() { await this.base.$disconnect(); }
  async transaction<T>(scope: StorageScope, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.base.$transaction(async tx => {
      const bypass = scope.kind === 'identity' || scope.kind === 'platform';
      await tx.$queryRaw`SELECT set_config('app.school_id', ${scope.schoolId ?? ''}, true), set_config('app.user_id', ${scope.userId ?? ''}, true), set_config('app.bypass_rls', ${bypass ? 'on' : 'off'}, true)`;
      return work(tx);
    }, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 });
  }
}
