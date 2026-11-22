import { createHash } from 'node:crypto';
import type { NotificationPayload, NotificationType } from '@wasl/shared';
import type { AuthUser } from '../auth/auth.types';
import type { Announcement } from './entities';
import type { Repositories } from './repositories';

export async function activeStudents(r: Repositories, assignmentId: string): Promise<string[]> {
  const assignment = await r.academics.get('sectionSubjects', assignmentId);
  if (!assignment) return [];
  const ids = new Set((await r.academics.list('enrollments')).filter(e => e.sectionId === assignment.sectionId && e.status === 'ACTIVE').map(e => e.studentId));
  const result: string[] = [];
  for (const id of ids) if (await r.people.eligible(id, 'STUDENT')) result.push(id);
  return result;
}
export async function canReadAssignment(r: Repositories, actor: Pick<AuthUser, 'sub' | 'role'>, id: string, childId?: string): Promise<boolean> {
  const a = await r.academics.get('sectionSubjects', id);
  if (!a) return false;
  if (actor.role === 'SCHOOL_ADMIN') return true;
  if (actor.role === 'TEACHER') return a.teacherId === actor.sub;
  const students = await activeStudents(r, id);
  if (actor.role === 'STUDENT') return students.includes(actor.sub);
  if (actor.role !== 'PARENT') return false;
  const links = await r.links.forParent(actor.sub);
  return links.some(l => l.status === 'VERIFIED' && students.includes(l.studentId) && (!childId || l.studentId === childId));
}
export async function canReadAnnouncement(r: Repositories, actor: Pick<AuthUser, 'sub' | 'role'>, a: Announcement): Promise<boolean> {
  if (actor.role === 'SCHOOL_ADMIN') return true;
  if (a.status !== 'PUBLISHED' && !(actor.role === 'TEACHER' && a.authorId === actor.sub)) return false;
  return !a.sectionSubjectId || canReadAssignment(r, actor, a.sectionSubjectId);
}
export async function studentAndParentRecipients(r: Repositories, assignmentId: string, onlyStudentId?: string): Promise<{ userId: string; studentId: string }[]> {
  const students = (await activeStudents(r, assignmentId)).filter(id => !onlyStudentId || onlyStudentId === id);
  const result = students.map(studentId => ({ userId: studentId, studentId }));
  for (const link of await r.links.list()) {
    if (link.status === 'VERIFIED' && students.includes(link.studentId) && await r.people.eligible(link.parentId, 'PARENT')) result.push({ userId: link.parentId, studentId: link.studentId });
  }
  return result;
}
/** Deterministic IDs make event delivery unique per entity, recipient and child. */
export async function notify(r: Repositories, schoolId: string, type: NotificationType, recipients: { userId: string; studentId?: string }[], payload: Omit<NotificationPayload, 'studentId'>) {
  const now = new Date();
  await r.communication.notify(recipients.map(recipient => {
    const hash = createHash('sha256').update(JSON.stringify([schoolId, type, payload.entityId, recipient.userId, recipient.studentId ?? ''])).digest('hex');
    const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    return { id, schoolId, userId: recipient.userId, type, payload: { ...payload, ...(recipient.studentId ? { studentId: recipient.studentId } : {}) }, readAt: null, createdAt: now };
  }));
}
