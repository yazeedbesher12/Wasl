import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import type { MeDto, Role } from '@wasl/shared';
import { PrismaService } from '../prisma/prisma.service';
import { runAsSystem } from '../tenancy/tenant-context';
import { AuthUser } from './auth.types';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

// Higher roles first: the default active membership after login.
const ROLE_PRIORITY: Role[] = ['PLATFORM_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'PARENT', 'STUDENT'];

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async login(email: string, password: string) {
    // Login runs before we know the school, so it uses the system context.
    return runAsSystem(async () => {
      const user = await this.prisma.db.user.findUnique({ where: { email: email.toLowerCase() } });
      if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) {
        throw new UnauthorizedException('Wrong email or password');
      }
      const memberships = await this.activeMemberships(user.id);
      if (!memberships.length) throw new ForbiddenException('This account has no active role');
      memberships.sort((a, b) => ROLE_PRIORITY.indexOf(a.role) - ROLE_PRIORITY.indexOf(b.role));
      const active = memberships[0];
      const tokens = await this.issueTokens(user.id, user.email, active.schoolId, active.role);
      return { ...tokens, user: await this.me(user.id, active.schoolId) };
    });
  }

  async refresh(refreshToken: string) {
    return runAsSystem(async () => {
      const stored = await this.prisma.db.refreshToken.findUnique({
        where: { tokenHash: hash(refreshToken) },
        include: { user: true },
      });
      if (!stored || stored.revokedAt || stored.expiresAt < new Date() || !stored.user.active) {
        throw new UnauthorizedException('Invalid refresh token');
      }
      // Rotate: each refresh token can be used once.
      await this.prisma.db.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      });
      const memberships = await this.activeMemberships(stored.userId);
      if (!memberships.length) throw new ForbiddenException('This account has no active role');
      memberships.sort((a, b) => ROLE_PRIORITY.indexOf(a.role) - ROLE_PRIORITY.indexOf(b.role));
      return this.issueTokens(stored.userId, stored.user.email, memberships[0].schoolId, memberships[0].role);
    });
  }

  async logout(refreshToken: string) {
    await runAsSystem(() =>
      this.prisma.db.refreshToken.updateMany({
        where: { tokenHash: hash(refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    );
  }

  /** Change the active school and role, if the user really has that membership. */
  async switchSchool(user: AuthUser, schoolId: string | null, role: Role) {
    return runAsSystem(async () => {
      const membership = await this.prisma.db.membership.findFirst({
        where: { userId: user.sub, schoolId, role, active: true },
      });
      if (!membership) throw new ForbiddenException('You do not have that role in that school');
      return this.issueTokens(user.sub, user.email, schoolId, role);
    });
  }

  async me(userId: string, activeSchoolId: string | null): Promise<MeDto> {
    return runAsSystem(async () => {
      const user = await this.prisma.db.user.findUniqueOrThrow({ where: { id: userId } });
      const memberships = await this.activeMemberships(userId);
      return {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        preferredLanguage: user.preferredLanguage,
        activeSchoolId,
        memberships: memberships.map((m) => ({
          schoolId: m.schoolId,
          schoolName: m.school?.name ?? null,
          role: m.role,
        })),
      };
    });
  }

  private activeMemberships(userId: string) {
    return this.prisma.db.membership.findMany({
      where: { userId, active: true, OR: [{ schoolId: null }, { school: { active: true } }] },
      include: { school: true },
    });
  }

  private async issueTokens(userId: string, email: string, schoolId: string | null, role: Role) {
    const claims: AuthUser = { sub: userId, email, schoolId, role };
    const accessToken = await this.jwt.signAsync(claims);
    const refreshToken = randomBytes(48).toString('base64url');
    const days = Number(this.config.get('JWT_REFRESH_TTL_DAYS', 30));
    await this.prisma.db.refreshToken.create({
      data: {
        userId,
        tokenHash: hash(refreshToken),
        expiresAt: new Date(Date.now() + days * 24 * 3600 * 1000),
      },
    });
    return { accessToken, refreshToken };
  }
}
