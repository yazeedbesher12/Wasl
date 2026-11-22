import { ApiProperty } from '@nestjs/swagger';
import { ASSESSMENT_STATUSES, ASSESSMENT_TYPES, SUBMISSION_STATUSES } from '@wasl/shared';
import { QuestionAuthorResponse, QuestionSafeResponse } from './responses';

export class AssessmentResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) schoolId: string;
  @ApiProperty({ format: 'uuid' }) sectionSubjectId: string;
  @ApiProperty({ enum: [...ASSESSMENT_TYPES] }) type: string;
  @ApiProperty() title: string;
  @ApiProperty({ type: String, nullable: true }) instructions: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) opensAt: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) dueAt: string | null;
  @ApiProperty({ enum: [...ASSESSMENT_STATUSES], description: 'Effective status at request time, including scheduled opening and deadline closure.' }) status: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) resultsReleasedAt: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty() questionCount: number;
  @ApiProperty() totalPoints: number;
}
class OrderedAuthorQuestion extends QuestionAuthorResponse { @ApiProperty() order: number; }
class OrderedSafeQuestion extends QuestionSafeResponse { @ApiProperty() order: number; }
export class AssessmentAuthorResponse extends AssessmentResponse { @ApiProperty({ type: [OrderedAuthorQuestion] }) questions: OrderedAuthorQuestion[]; }
export class AssessmentDetailResponse extends AssessmentResponse { @ApiProperty({ type: [OrderedSafeQuestion], description: 'Empty before opensAt. Written-answer model answers are never included.' }) questions: OrderedSafeQuestion[]; }
export class AnswerResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) questionId: string;
  @ApiProperty({ type: String, nullable: true }) response: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'File metadata only.' }) fileKey: string | null;
  @ApiProperty({ type: Number, nullable: true }) score: number | null;
}
export class SubmissionResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) schoolId: string;
  @ApiProperty({ format: 'uuid' }) assessmentId: string;
  @ApiProperty({ format: 'uuid' }) studentId: string;
  @ApiProperty({ enum: [...SUBMISSION_STATUSES], description: 'GRADED is projected as SUBMITTED to students until release.' }) status: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) submittedAt: string | null;
  @ApiProperty({ type: Number, nullable: true }) score: number | null;
  @ApiProperty({ type: String, nullable: true }) feedback: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) gradedAt: string | null;
  @ApiProperty() resultsReleased: boolean;
  @ApiProperty({ type: [AnswerResponse] }) answers: AnswerResponse[];
}
export class ReleasedResultResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ type: AssessmentResponse }) assessment: AssessmentResponse;
  @ApiProperty({ type: SubmissionResponse }) submission: SubmissionResponse;
}
