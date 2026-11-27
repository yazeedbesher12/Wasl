import { Prisma, PrismaClient } from '@prisma/client';
import { compare, hash } from 'bcryptjs';

const marker = 'wasl-local-postgres17-development-v1';
const email = 'platform-admin@wasl.local';

async function seed() {
  const password = process.env.WASL_DEV_ADMIN_PASSWORD ?? '';
  const port = Number(process.env.WASL_DEV_POSTGRES_PORT ?? 55437);
  const target = new URL(process.env.MIGRATION_DATABASE_URL ?? '');
  if (
    process.env.NODE_ENV !== 'development' || process.env.WASL_DEV_DATABASE_MARKER !== marker ||
    !/^[a-f0-9]{48}$/.test(password) || !Number.isInteger(port) || [5432, 5433, 55436].includes(port) ||
    target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || Number(target.port) !== port ||
    target.pathname !== '/wasl_dev' || decodeURIComponent(target.username) !== 'wasl_migrate' ||
    !target.password || target.search !== '?schema=public' || target.hash
  ) throw new Error('Invalid persistent development database configuration.');

  const db = new PrismaClient({ datasources: { db: { url: target.href } } });
  try {
    return await db.$transaction(async tx => {
      const [identity] = await tx.$queryRaw<{ valid: boolean }[]>`
        SELECT current_database() = 'wasl_dev' AND current_user = 'wasl_migrate'
          AND pg_get_userbyid(datdba) = current_user AND inet_server_port() = 5432
          AND current_setting('server_version_num')::int BETWEEN 170000 AND 179999
          AND shobj_description(oid, 'pg_database') = ${marker} AS valid
        FROM pg_database WHERE datname = current_database()`;
      if (!identity?.valid) throw new Error('Unexpected persistent development database identity.');

      const existing = await tx.user.findUnique({ where: { email }, include: { memberships: true } });
      if (existing) {
        const membership = existing.memberships[0];
        if (!existing.active || existing.memberships.length !== 1 || !membership?.active ||
            membership.schoolId !== null || membership.role !== 'PLATFORM_ADMIN' ||
            !await compare(password, existing.passwordHash))
          throw new Error('Existing development administrator does not match the configured account.');
        return 'Fictional local platform administrator already exists.';
      }
      await tx.user.create({ data: {
        email,
        fullName: 'Fictional Local Platform Administrator',
        passwordHash: await hash(password, 12),
        memberships: { create: { role: 'PLATFORM_ADMIN' } },
      } });
      return 'Created fictional local platform administrator.';
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } finally { await db.$disconnect(); }
}

void seed().then(message => console.log(message)).catch(() => {
  console.error('Development seed refused or failed. Verify the marked local database and private environment file.');
  process.exitCode = 1;
});
