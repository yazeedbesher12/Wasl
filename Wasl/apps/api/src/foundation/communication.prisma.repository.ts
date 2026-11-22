import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { NOTIFICATION_TYPES } from '@wasl/shared';
import type { NotificationPayload, NotificationType } from '@wasl/shared';
import type { CommunicationRepository, FileRepository } from './repositories';
import type { Notification } from './entities';

function payload(value: Prisma.JsonValue): NotificationPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.entityId !== 'string' || value.sectionSubjectId !== null && typeof value.sectionSubjectId !== 'string' || value.studentId !== undefined && typeof value.studentId !== 'string') throw new Error('Invalid stored notification');
  return { entityId: value.entityId, sectionSubjectId: value.sectionSubjectId, ...(value.studentId ? { studentId: value.studentId } : {}) };
}
export function prismaCommunication(tx: Prisma.TransactionClient, schoolId: string, userId: string | null): CommunicationRepository {
  const scoped = (row: { schoolId: string }) => { if (row.schoolId !== schoolId) throw new NotFoundException('Record not found'); };
  const map = (n: Omit<Notification, 'payload' | 'type'> & { payload: Prisma.JsonValue; type: string }): Notification => ({ ...n, type: n.type as NotificationType, payload: payload(n.payload) });
  return {
    announcements: () => tx.announcement.findMany({ where: { schoolId } }),
    announcement: id => tx.announcement.findFirst({ where: { schoolId, id } }),
    createAnnouncement: data => { scoped(data); return tx.announcement.create({ data }); },
    updateAnnouncement: data => { scoped(data); return tx.announcement.update({ where: { id: data.id, schoolId }, data }); },
    notifications: async id => id === userId ? (await tx.notification.findMany({ where: { schoolId, userId: id, type: { in: [...NOTIFICATION_TYPES] } } })).map(map) : [],
    notify: async rows => { rows.forEach(scoped); if (rows.length) await tx.notification.createMany({ data: rows.map(n => ({ ...n, payload: { ...n.payload } })), skipDuplicates: true }); },
    markRead: async (id, recipient, at) => {
      if (recipient !== userId) throw new NotFoundException('Record not found');
      const row = await tx.notification.findFirst({ where: { id, schoolId, userId: recipient, type: { in: [...NOTIFICATION_TYPES] } } });
      if (!row) throw new NotFoundException('Record not found');
      return map(row.readAt ? row : await tx.notification.update({ where: { id, schoolId, userId: recipient }, data: { readAt: at } }));
    },
  };
}
export function prismaFiles(tx: Prisma.TransactionClient, schoolId: string): FileRepository {
  return {
    get: id => tx.fileObject.findFirst({ where: { id, schoolId } }),
    byKey: storageKey => tx.fileObject.findFirst({ where: { storageKey, schoolId } }),
    create: data => { if (data.schoolId !== schoolId) throw new NotFoundException('Record not found'); return tx.fileObject.create({ data }); },
  };
}
