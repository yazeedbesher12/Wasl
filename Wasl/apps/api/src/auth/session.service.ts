import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import { ROLES } from '@wasl/shared';
import type { MeDto, Role } from '@wasl/shared';
import { activeMembership, requireActor } from '../foundation/authorization';
import type { Membership } from '../foundation/entities';
import type { FoundationStorage, Repositories } from '../foundation/repositories';
import { STORAGE } from '../foundation/repositories';
import { AuthUser } from './auth.types';

const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const priority: Role[] = ['PLATFORM_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'PARENT', 'STUDENT'];
const identityScope = { kind: 'identity', userId: null, schoolId: null } as const;
const invalid = () => new UnauthorizedException('Invalid or unavailable session');

@Injectable()
export class AuthService {
  private readonly refreshKey: Buffer;
  private dummyHash: Promise<string>;
  constructor(@Inject(STORAGE) private storage: FoundationStorage, private jwt: JwtService, private config: ConfigService) {
    this.refreshKey = createHash('sha256').update(config.getOrThrow<string>('JWT_REFRESH_SECRET')).digest();
    this.dummyHash = bcrypt.hash(randomBytes(24).toString('hex'), 12);
  }
  async login(email: string, password: string) {
    if (Buffer.byteLength(password, 'utf8') > 72) throw new UnauthorizedException('Wrong email or password');
    const normalized = email.trim().toLowerCase();
    // Fetch a single identity internally. Password work stays outside the transaction lock.
    const candidate = await this.storage.run(identityScope, r => r.identity.personByEmail(normalized));
    const valid = await bcrypt.compare(password, candidate?.passwordHash ?? await this.dummyHash);
    if (!candidate?.active || !valid) throw new UnauthorizedException('Wrong email or password');
    return this.storage.run(identityScope, async r => {
      const current = await r.identity.personById(candidate.id);
      if (!current?.active || current.passwordHash !== candidate.passwordHash) throw new UnauthorizedException('Wrong email or password');
      const memberships = await this.available(r, candidate.id);
      memberships.sort((a,b) => priority.indexOf(a.role) - priority.indexOf(b.role) || a.id.localeCompare(b.id));
      if (!memberships[0]) throw new UnauthorizedException('Wrong email or password');
      const selected = memberships[0]; const tokens = await this.issue(r, current.id, current.email, selected);
      return { ...tokens, user: await this.meInside(r, current.id, selected) };
    });
  }
  async refresh(token: string) {
    return this.storage.run(identityScope, async r => {
      const saved = await r.identity.refreshByHash(digest(token));
      if (!saved || saved.revokedAt || saved.expiresAt <= new Date()) throw invalid();
      const selected = await activeMembership(r, saved.userId, this.refreshMembership(token));
      const user = await r.identity.personById(saved.userId); if (!user?.active) throw invalid();
      if (!await r.identity.consumeRefresh(digest(token), new Date())) throw invalid();
      return this.issue(r, user.id, user.email, selected);
    });
  }
  async logout(token: string) { await this.storage.run(identityScope, r => r.identity.revokeRefresh(digest(token), new Date())); }
  async switchSchool(actor: AuthUser, schoolId: string | null, role: Role) {
    return this.storage.run({ ...identityScope, userId: actor.sub }, async r => {
      await requireActor(r, actor);
      const selected = (await this.available(r, actor.sub)).find(m => m.schoolId === schoolId && m.role === role);
      if (!selected) throw new ForbiddenException('Requested membership is unavailable');
      const user = await r.identity.personById(actor.sub); if (!user) throw invalid();
      return this.issue(r, user.id, user.email, selected);
    });
  }
  async validateAccess(claims: AuthUser): Promise<AuthUser> {
    if (!claims || !isUUID(claims.sub) || !isUUID(claims.membershipId) || !ROLES.includes(claims.role) || claims.schoolId !== null && !isUUID(claims.schoolId)) throw invalid();
    return this.storage.run({ ...identityScope, userId: claims.sub }, async r => {
      await requireActor(r, claims);
      const user = await r.identity.personById(claims.sub); if (!user) throw invalid();
      return { sub: user.id, email: user.email, membershipId: claims.membershipId, schoolId: claims.schoolId, role: claims.role };
    });
  }
  async me(actor: AuthUser): Promise<MeDto> {
    return this.storage.run({ ...identityScope, userId: actor.sub }, async r => { const selected = await requireActor(r, actor); return this.meInside(r, actor.sub, selected); });
  }
  private async available(r: Repositories, userId: string) {
    const rows = await r.identity.membershipsFor(userId); const result: Membership[] = [];
    for (const m of rows) if (m.active && (m.role === 'PLATFORM_ADMIN' ? m.schoolId === null : m.schoolId !== null && (await r.schools.get(m.schoolId))?.active)) result.push(m);
    return result;
  }
  private async meInside(r: Repositories, userId: string, selected: Membership): Promise<MeDto> {
    const user = await r.identity.personById(userId); if (!user?.active) throw invalid();
    const memberships = await Promise.all((await this.available(r, userId)).map(async m => ({ id: m.id, schoolId: m.schoolId, schoolName: m.schoolId ? (await r.schools.get(m.schoolId))?.name ?? null : null, role: m.role })));
    return { id: user.id, email: user.email, fullName: user.fullName, preferredLanguage: user.preferredLanguage, activeSchoolId: selected.schoolId, activeRole: selected.role, membershipId: selected.id, memberships };
  }
  private async issue(r: Repositories, userId: string, email: string, membership: Membership) {
    const claims: AuthUser = { sub: userId, email, schoolId: membership.schoolId, role: membership.role, membershipId: membership.id };
    const accessToken = await this.jwt.signAsync(claims);
    // Authenticated encryption keeps the entire token opaque while avoiding nonexistent schema columns.
    const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.refreshKey, nonce);
    cipher.setAAD(Buffer.from('wasl-refresh-v1'));
    const encrypted = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(membership.id, 'ascii'), randomBytes(32)])), cipher.final()]);
    const refreshToken = 'v1.' + Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64url');
    await r.identity.createRefresh({ id: randomUUID(), userId, tokenHash: digest(refreshToken), expiresAt: new Date(Date.now() + this.config.getOrThrow<number>('JWT_REFRESH_TTL_DAYS') * 86400000), revokedAt: null, createdAt: new Date() });
    return { accessToken, refreshToken };
  }
  private refreshMembership(token: string): string {
    try {
      if (!/^v1\.[A-Za-z0-9_-]+$/.test(token)) throw invalid();
      const data = Buffer.from(token.slice(3), 'base64url'); if (data.length !== 96) throw invalid();
      const decipher = createDecipheriv('aes-256-gcm', this.refreshKey, data.subarray(0,12));
      decipher.setAAD(Buffer.from('wasl-refresh-v1')); decipher.setAuthTag(data.subarray(12,28));
      const plain = Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]); const id = plain.subarray(0,36).toString('ascii');
      if (plain.length !== 68 || !isUUID(id)) throw invalid(); return id;
    } catch { throw invalid(); }
  }
}
