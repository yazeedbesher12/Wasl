import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { currentTenant } from '../tenancy/tenant-context';

function withTenant(base: PrismaClient) {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const ctx = currentTenant();
          // Each query runs in a short transaction that first sets the
          // tenant variables read by the row-level security policies.
          const [, , , result] = await base.$transaction([
            base.$executeRaw`SELECT set_config('app.school_id', ${ctx?.schoolId ?? ''}, true)`,
            base.$executeRaw`SELECT set_config('app.user_id', ${ctx?.userId ?? ''}, true)`,
            base.$executeRaw`SELECT set_config('app.bypass_rls', ${ctx?.bypass ? 'on' : 'off'}, true)`,
            query(args),
          ]);
          return result;
        },
      },
    },
  });
}

export type TenantPrisma = ReturnType<typeof withTenant>;

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly base = new PrismaClient();
  /** Use this client for all queries: it is scoped to the current tenant. */
  readonly db: TenantPrisma = withTenant(this.base);

  async onModuleInit() {
    await this.base.$connect();
  }

  async onModuleDestroy() {
    await this.base.$disconnect();
  }
}
