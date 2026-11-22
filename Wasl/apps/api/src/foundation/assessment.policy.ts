import type { AssessmentStatus } from '@wasl/shared';
import type { Assessment } from './entities';

/** Time transitions are derived on every request; no background job is required. */
export function assessmentStatus(a: Assessment, now = new Date()): AssessmentStatus {
  if (a.status !== 'SCHEDULED' && a.status !== 'OPEN') return a.status;
  if (a.dueAt && now >= a.dueAt) return 'CLOSED';
  if (a.opensAt && now < a.opensAt) return 'SCHEDULED';
  return 'OPEN';
}
export function studentCanReadQuestions(a: Assessment, now = new Date()): boolean {
  return a.status !== 'DRAFT' && (!a.opensAt || now >= a.opensAt);
}
