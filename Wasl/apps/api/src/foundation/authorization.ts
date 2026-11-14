import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Role } from '@wasl/shared';
import type { AuthUser } from '../auth/auth.types';
import type { Repositories } from './repositories';
import type { Membership } from './entities';

export async function activeMembership(r: Repositories, userId: string, membershipId: string): Promise<Membership> {
  const user = await r.identity.personById(userId);
  const membership = (await r.identity.membershipsFor(userId)).find(m => m.id === membershipId && m.active);
  if (!user?.active || !membership) throw new UnauthorizedException('Active account or membership unavailable');
  if (membership.role === 'PLATFORM_ADMIN') { if (membership.schoolId !== null) throw new UnauthorizedException('Invalid membership'); }
  else if (!membership.schoolId || !(await r.schools.get(membership.schoolId))?.active) throw new UnauthorizedException('Active school unavailable');
  return membership;
}
export async function requireActor(r: Repositories, actor: AuthUser, roles?: readonly Role[]) {
  const membership = await activeMembership(r, actor.sub, actor.membershipId);
  if (membership.role !== actor.role || membership.schoolId !== actor.schoolId) throw new UnauthorizedException('Active context changed');
  if (roles && !roles.includes(actor.role)) throw new ForbiddenException('Your role cannot do this');
  return membership;
}
