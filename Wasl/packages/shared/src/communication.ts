import type { ListQuery, PublishStatus } from './foundation';

export const FILE_PURPOSES = ['LESSON_RESOURCE', 'ASSESSMENT_ANSWER'] as const;
export type FilePurpose = typeof FILE_PURPOSES[number];
export interface FileUploadInput { purpose: FilePurpose; lessonId?: string; assessmentId?: string }
export interface FileDto { id: string; schoolId: string; ownerId: string; purpose: FilePurpose; lessonId: string | null; assessmentId: string | null; storageKey: string; originalName: string; contentType: string; size: number; createdAt: string }
export interface ParentFileContext { studentId: string; schoolId: string }
export interface AnnouncementCreate { sectionSubjectId?: string | null; title: string; body: string }
export interface AnnouncementUpdate { title?: string; body?: string }
export interface AnnouncementDto { id: string; schoolId: string; authorId: string; sectionSubjectId: string | null; title: string; body: string; status: PublishStatus; publishedAt: string | null; createdAt: string }
export type AnnouncementQuery = Pick<ListQuery, 'page' | 'limit' | 'search' | 'sort' | 'order'> & { sectionSubjectId?: string; status?: PublishStatus };
export const NOTIFICATION_TYPES = ['ANNOUNCEMENT_PUBLISHED', 'ASSESSMENT_PUBLISHED', 'SUBMISSION_RECEIVED', 'RESULTS_RELEASED'] as const;
export type NotificationType = typeof NOTIFICATION_TYPES[number];
export interface NotificationPayload { entityId: string; sectionSubjectId: string | null; studentId?: string }
export interface NotificationDto { id: string; schoolId: string; type: NotificationType; payload: NotificationPayload; title: string; titleAr: string; readAt: string | null; createdAt: string }
export type NotificationQuery = Pick<ListQuery, 'page' | 'limit' | 'search' | 'sort' | 'order'> & { read?: 'all' | 'read' | 'unread' };

export interface ParentLearningDto { units: import('./foundation').UnitDto[]; lessons: import('./foundation').LessonDto[]; resources: import('./foundation').ResourceDto[]; assessments: import('./assessment').AssessmentDto[]; announcements: AnnouncementDto[] }
