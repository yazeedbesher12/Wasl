import type { Locale } from "../index";
export type { Locale };
export interface School {
  id: string; name: string; nameAr: string; locale: Locale; active: boolean; createdAt: string;
  demo: { city: string; cityAr: string; administrator: string; administratorAr: string; email: string; students: number; teachers: number };
}
export type SchoolInput = Pick<School, "name" | "nameAr" | "active" | "locale"> & {
  city: string; cityAr: string; administrator: string; administratorAr: string; email: string;
};
export type Action = "created" | "edited" | "suspended" | "reactivated";
export interface Activity { id: string; schoolId: string; action: Action; actor: string; actorAr: string; at: string }
export interface LegacyState { version: 1; schools: School[]; activity: Activity[]; administrator: { name: string; nameAr: string; email: string } }
export const kinds = ["users", "memberships", "years", "semesters", "grades", "sections", "subjects", "assignments", "enrollments", "links", "units", "lessons", "resources", "banks", "questions", "assessments", "assessmentQuestions", "submissions", "answers", "scores", "announcements", "notifications", "preferences"] as const;
export type Kind = typeof kinds[number];
/** Demo form records only, not production DTOs. Values use schema-validated strings.
 * References always contain stable IDs; numbers/dates are parsed at the boundary.
 * Global people have an empty schoolId; all other records belong to one school. */
export interface DemoRecord { id: string; schoolId: string; name: string; nameAr: string; active: boolean; values: Record<string, string> }
export type Tables = { [K in Kind]: DemoRecord[] };
export interface DemoEvent { id: string; schoolId: string; actorId: string; kind: Kind; recordId: string; verb: string; at: string }
export interface AnswerDraft { id: string; schoolId: string; studentId: string; assessmentId: string; responses: Record<string, string>; revision: number; updatedAt: string }
export interface Snapshot extends Omit<LegacyState, "version"> { version: 3; records: Tables; events: DemoEvent[]; answerDrafts: AnswerDraft[] }
export interface Session { membershipId: string; childLinkId?: string }
export const workspaceRoles = ["SCHOOL_ADMIN", "TEACHER", "STUDENT", "PARENT"] as const;
export const CHILD_KEY = "wasl.demo.child-link";
export const roleWorkspace = (role: string) => role === "SCHOOL_ADMIN" ? "school" : role === "TEACHER" ? "teacher" : role === "STUDENT" ? "student" : role === "PARENT" ? "parent" : "";
export interface StorageAdapter { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> }
export const STORAGE_KEY = "wasl.platform-demo.v1"; // Keep the existing key; the document carries schema v2.
export const SESSION_KEY = "wasl.demo.membership";
export const LOCALE_KEY = "wasl.locale";
export const tokens = { background: "#F7F9FC", surface: "#FFFFFF", primary: "#2F6FED", tint: "#EDF3FF", text: "#111827", muted: "#596579", border: "#E5EAF1", green: "#23734A", amber: "#895615", red: "#B33838", radius: 18, controlRadius: 12 };
export class DemoError extends Error {
  constructor(public code: string, public field?: string) { super(code); }
}
export type RecordInput = { name: string; nameAr: string; values: Record<string, string> };
export type StaffCommand =
  | { type: "save"; kind: Kind; id?: string; input: RecordInput }
  | { type: "transition"; kind: Kind; id: string; verb: "archive" | "activate" | "publish" | "close" | "approve" | "revoke" | "read" | "unread" | "release" }
  | { type: "grade"; id: string; scores: { questionId: string; score: string; feedback: string }[] }
  | { type: "schoolProfile"; input: Record<string, string> };
export type LearningCommand =
  | { type: "saveAnswers" | "submitAnswers"; assessmentId: string; responses: Record<string, string>; revision: number }
  | { type: "readLearningNotification"; id: string; read: boolean };
export type Command = StaffCommand | LearningCommand;
