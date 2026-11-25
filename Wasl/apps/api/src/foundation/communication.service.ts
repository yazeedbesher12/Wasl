import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AnnouncementDto, NotificationDto, Page, Role } from '@wasl/shared';
import type { AuthUser } from '../auth/auth.types';
import { requireActor } from './authorization';
import type { Announcement, Notification } from './entities';
import { STORAGE } from './repositories';
import type { FoundationStorage, Repositories } from './repositories';
import { pageOf } from './foundation.service';
import type { AnnouncementListDto, CreateAnnouncementDto, NotificationListDto, UpdateAnnouncementDto } from './communication.dto';
import { canReadAnnouncement, canReadAssignment, notify, studentAndParentRecipients } from './communication.policy';

const missing = () => new NotFoundException('Record not found');
const roles: readonly Role[] = ['SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'PARENT'];
const announcementDto = (a: Announcement): AnnouncementDto => ({ ...a, createdAt: a.createdAt.toISOString(), publishedAt: a.publishedAt?.toISOString() ?? null });
const titles = {
  ANNOUNCEMENT_PUBLISHED: ['New announcement', 'إعلان جديد'],
  ASSESSMENT_PUBLISHED: ['New assignment or exam', 'واجب أو امتحان جديد'],
  SUBMISSION_RECEIVED: ['Submission received', 'تم استلام التسليم'],
  RESULTS_RELEASED: ['Results are available', 'النتائج متاحة الآن'],
} as const;
const notificationDto = (n: Notification): NotificationDto => ({ id: n.id, schoolId: n.schoolId, type: n.type, payload: n.payload, title: titles[n.type][0], titleAr: titles[n.type][1], readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() });

@Injectable()
export class CommunicationService {
  constructor(@Inject(STORAGE) private storage: FoundationStorage) {}
  private school<T>(actor: AuthUser, allowed: readonly Role[], work: (r: Repositories) => Promise<T>, announcementWrite = false) {
    if (!actor.schoolId) throw new ForbiddenException('An active school role is required');
    return this.storage.run({ kind: 'school', userId: actor.sub, schoolId: actor.schoolId,
      assessment: { membershipId: actor.membershipId, operation: announcementWrite ? 'announcement-write' : 'metadata', targetId: actor.sub } },
    async r => { await requireActor(r, actor, allowed); return work(r); });
  }
  private async writableClass(r: Repositories, actor: AuthUser, id: string | null) {
    if (!id) { if (actor.role !== 'SCHOOL_ADMIN') throw new ForbiddenException('Teachers must select an assigned class'); return; }
    const a = await r.academics.get('sectionSubjects', id);
    if (!a || !await canReadAssignment(r, actor, id)) throw missing();
    const section = await r.academics.get('sections', a.sectionId);
    const year = section && await r.academics.get('academicYears', section.academicYearId);
    if (!year) throw missing();
    if (year.archived) throw new ConflictException('Announcements in archived academic years are read-only');
  }
  private async writable(r: Repositories, actor: AuthUser, id: string) {
    const a = await r.communication.announcement(id);
    if (!a || actor.role === 'TEACHER' && a.authorId !== actor.sub) throw missing();
    await this.writableClass(r, actor, a.sectionSubjectId); return a;
  }
  list(actor: AuthUser, q: AnnouncementListDto): Promise<Page<AnnouncementDto>> {
    return this.school(actor, roles, async r => {
      const rows: Announcement[] = [];
      for (const a of await r.communication.announcements()) if ((!q.sectionSubjectId || q.sectionSubjectId === a.sectionSubjectId) && (!q.status || q.status === a.status) && await canReadAnnouncement(r, actor, a)) rows.push(a);
      const page = pageOf(rows, q, a => a.title); return { ...page, items: page.items.map(announcementDto) };
    });
  }
  get(actor: AuthUser, id: string) {
    return this.school(actor, roles, async r => { const a = await r.communication.announcement(id); if (!a || !await canReadAnnouncement(r, actor, a)) throw missing(); return announcementDto(a); });
  }
  create(actor: AuthUser, input: CreateAnnouncementDto) {
    return this.school(actor, ['TEACHER', 'SCHOOL_ADMIN'], async r => {
      await this.writableClass(r, actor, input.sectionSubjectId ?? null);
      return announcementDto(await r.communication.createAnnouncement({ id: randomUUID(), schoolId: actor.schoolId!, authorId: actor.sub, sectionSubjectId: input.sectionSubjectId ?? null, title: input.title, body: input.body, status: 'DRAFT', publishedAt: null, createdAt: new Date() }));
    }, true);
  }
  update(actor: AuthUser, id: string, input: UpdateAnnouncementDto) {
    return this.school(actor, ['TEACHER', 'SCHOOL_ADMIN'], async r => {
      const a = await this.writable(r, actor, id);
      if (a.status !== 'DRAFT') throw new ConflictException('Only draft announcements can be edited');
      return announcementDto(await r.communication.updateAnnouncement({ ...a, title: input.title ?? a.title, body: input.body ?? a.body }));
    }, true);
  }
  transition(actor: AuthUser, id: string, action: 'publish' | 'archive') {
    return this.school(actor, ['TEACHER', 'SCHOOL_ADMIN'], async r => {
      const a = await this.writable(r, actor, id);
      if (action === 'archive') {
        if (a.status !== 'PUBLISHED') throw new ConflictException('Only published announcements can be archived');
        return announcementDto(await r.communication.updateAnnouncement({ ...a, status: 'ARCHIVED' }));
      }
      if (a.status !== 'DRAFT') throw new ConflictException('Only draft announcements can be published');
      const updated = await r.communication.updateAnnouncement({ ...a, status: 'PUBLISHED', publishedAt: new Date() });
      let recipients: { userId: string; studentId?: string }[];
      if (a.sectionSubjectId) recipients = await studentAndParentRecipients(r, a.sectionSubjectId);
      else {
        recipients = [];
        for (const m of await r.people.memberships()) if (m.active && await r.people.eligible(m.userId, m.role)) recipients.push({ userId: m.userId });
      }
      await notify(r, a.schoolId, 'ANNOUNCEMENT_PUBLISHED', recipients.filter(v => v.userId !== actor.sub), { entityId: id, sectionSubjectId: a.sectionSubjectId });
      return announcementDto(updated);
    }, true);
  }
  private async visibleNotifications(r: Repositories, actor: AuthUser) {
    const rows: Notification[] = [];
    for (const n of await r.communication.notifications(actor.sub)) {
      if (n.type === 'ANNOUNCEMENT_PUBLISHED') {
        const a = await r.communication.announcement(n.payload.entityId);
        if (a?.status === 'PUBLISHED' && await canReadAnnouncement(r, actor, a) && (!n.payload.studentId || !a.sectionSubjectId || await canReadAssignment(r, actor, a.sectionSubjectId, n.payload.studentId))) rows.push(n);
        continue;
      }
      const submission = n.type === 'SUBMISSION_RECEIVED' ? await r.assessments.submission(n.payload.entityId) : null;
      const assessment = await r.assessments.get(submission?.assessmentId ?? n.payload.entityId);
      if (!assessment || assessment.status === 'DRAFT' || !await canReadAssignment(r, actor, assessment.sectionSubjectId, n.payload.studentId)) continue;
      if (n.type === 'RESULTS_RELEASED' && (!assessment.resultsReleasedAt || !['RESULTS_RELEASED', 'ARCHIVED'].includes(assessment.status))) continue;
      if (n.type === 'SUBMISSION_RECEIVED' && (!submission || submission.status === 'IN_PROGRESS' || actor.role === 'STUDENT' && submission.studentId !== actor.sub)) continue;
      rows.push(n);
    }
    return rows;
  }
  notifications(actor: AuthUser, q: NotificationListDto): Promise<Page<NotificationDto>> {
    return this.school(actor, roles, async r => {
      const rows = (await this.visibleNotifications(r, actor)).filter(n => q.read === 'all' || (q.read === 'read' ? !!n.readAt : !n.readAt)).map(notificationDto);
      return pageOf(rows, q, n => n.title + ' ' + n.titleAr);
    });
  }
  unreadCount(actor: AuthUser) { return this.school(actor, roles, async r => ({ count: (await this.visibleNotifications(r, actor)).filter(n => !n.readAt).length })); }
  markRead(actor: AuthUser, id: string) {
    return this.school(actor, roles, async r => { if (!(await this.visibleNotifications(r, actor)).some(n => n.id === id)) throw missing(); return notificationDto(await r.communication.markRead(id, actor.sub, new Date())); });
  }
  markAllRead(actor: AuthUser) {
    return this.school(actor, roles, async r => { const rows = (await this.visibleNotifications(r, actor)).filter(n => !n.readAt); const at = new Date(); for (const n of rows) await r.communication.markRead(n.id, actor.sub, at); return { count: rows.length }; });
  }
}
