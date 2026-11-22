import { ConflictException, NotFoundException } from '@nestjs/common';
import type { MemoryState } from './memory.seed';
import type { CommunicationRepository, FileRepository } from './repositories';

export function memoryCommunication(s: MemoryState, schoolId: string | null, userId: string | null): CommunicationRepository {
  const scoped = (row: { schoolId: string }) => schoolId !== null && row.schoolId === schoolId;
  const missing = () => new NotFoundException('Record not found');
  return {
    announcements: async () => s.announcements.filter(scoped),
    announcement: async id => s.announcements.find(a => a.id === id && scoped(a)) ?? null,
    createAnnouncement: async row => { if (!scoped(row)) throw missing(); if (s.announcements.some(a => a.id === row.id)) throw new ConflictException(); s.announcements.push(row); return row; },
    updateAnnouncement: async row => { const index = s.announcements.findIndex(a => a.id === row.id && scoped(a)); if (index < 0 || !scoped(row)) throw missing(); s.announcements[index] = row; return row; },
    notifications: async id => id === userId ? s.notifications.filter(n => scoped(n) && n.userId === id) : [],
    notify: async rows => { for (const row of rows) { if (!scoped(row)) throw missing(); if (!s.notifications.some(n => n.id === row.id)) s.notifications.push(row); } },
    markRead: async (id, recipient, at) => {
      const row = s.notifications.find(n => scoped(n) && n.id === id && n.userId === recipient && recipient === userId);
      if (!row) throw missing(); row.readAt ??= at; return row;
    },
  };
}
export function memoryFiles(s: MemoryState, schoolId: string | null): FileRepository {
  const scoped = (row: { schoolId: string }) => schoolId !== null && row.schoolId === schoolId;
  return {
    get: async id => s.files.find(f => f.id === id && scoped(f)) ?? null,
    byKey: async key => s.files.find(f => f.storageKey === key && scoped(f)) ?? null,
    create: async row => {
      if (!scoped(row)) throw new NotFoundException('Record not found');
      if (s.files.some(f => f.id === row.id || f.storageKey === row.storageKey)) throw new ConflictException();
      s.files.push(row); return row;
    },
  };
}
