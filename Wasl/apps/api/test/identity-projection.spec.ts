import { ForbiddenException } from '@nestjs/common';
import { PrismaStorage } from '../src/foundation/prisma.adapter';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { StorageScope } from '../src/foundation/repositories';

describe('Prisma identity projection', () => {
  const findUnique = jest.fn().mockResolvedValue(null);
  const create = jest.fn().mockResolvedValue({});
  const update = jest.fn().mockResolvedValue({});
  const tx = { user: { findUnique, create, update } };
  const prisma = { transaction: (_scope: StorageScope, work: (transaction: typeof tx) => unknown) => work(tx) };
  const pool = prisma as unknown as PrismaService;
  const storage = new PrismaStorage({ auth: pool, platform: pool, tenant: pool });
  const school = { kind: 'school', userId: 'actor', schoolId: 'school' } as const;
  const person = {
    id: 'person', email: 'person@example.test', fullName: 'Fictional Person',
    passwordHash: 'test-only', preferredLanguage: 'en' as const, active: true, createdAt: new Date(),
  };

  beforeEach(() => jest.clearAllMocks());

  it('selects only profile fields for profile reads and writes', async () => {
    await storage.run(school, async ({ identity }) => {
      await identity.personById(person.id);
      await identity.personByEmail(person.email);
      await identity.createPerson(person);
      await identity.updateProfile(person.id, { fullName: person.fullName, preferredLanguage: 'en' });
    });

    const select = { id: true, email: true, fullName: true, preferredLanguage: true, active: true, createdAt: true };
    expect(findUnique).toHaveBeenNthCalledWith(1, { where: { id: person.id }, select });
    expect(findUnique).toHaveBeenNthCalledWith(2, { where: { email: person.email }, select });
    expect(create).toHaveBeenCalledWith({ data: person, select });
    expect(update).toHaveBeenCalledWith({
      where: { id: person.id }, data: { fullName: person.fullName, preferredLanguage: 'en' }, select,
    });
  });

  it('selects password verification fields in authentication scope', async () => {
    await storage.run({ kind: 'authentication', schoolId: null, userId: null }, ({ authentication }) =>
      authentication.credentialByEmail(person.email));

    expect(findUnique).toHaveBeenCalledWith({
      where: { email: person.email }, select: { id: true, email: true, active: true, passwordHash: true },
    });
  });

  it.each(['identity', 'platform', 'school', 'parent-list'] as const)('blocks credential and session repositories in %s scope', async kind => {
    await expect(storage.run({ ...school, kind }, async ({ authentication }) =>
      authentication.credentialById(person.id))).rejects.toBeInstanceOf(ForbiddenException);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
