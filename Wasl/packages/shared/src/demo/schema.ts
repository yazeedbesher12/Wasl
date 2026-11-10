import type { Kind } from "./model";
export interface Field { key: string; type?: "text" | "long" | "number" | "date" | "email"; optional?: boolean; ref?: Kind; options?: readonly string[]; role?: string }
export interface Definition { fields: Field[]; unique?: string[][]; schoolAdmin?: boolean; teacher?: boolean; readonly?: boolean; named?: boolean }
const ref = (key: string, target: Kind, optional = false, role?: string): Field => ({ key, ref: target, optional, role });
const choice = (key: string, options: string[], optional = false): Field => ({ key, options, optional });
export const schema: Record<Kind, Definition> = {
  users: { fields: [{ key: "email", type: "email" }], readonly: true, named: true },
  memberships: { schoolAdmin: true, named: true, fields: [ref("userId", "users", true), { key: "email", type: "email", optional: true }, choice("role", ["TEACHER", "STUDENT", "PARENT"])], unique: [["userId", "role"]] },
  years: { schoolAdmin: true, named: true, fields: [{ key: "startDate", type: "date" }, { key: "endDate", type: "date" }], unique: [["name"]] },
  semesters: { schoolAdmin: true, named: true, fields: [ref("yearId", "years"), { key: "startDate", type: "date" }, { key: "endDate", type: "date" }], unique: [["yearId", "name"]] },
  grades: { schoolAdmin: true, named: true, fields: [{ key: "level", type: "number" }], unique: [["level"]] },
  sections: { schoolAdmin: true, named: true, fields: [ref("yearId", "years"), ref("gradeId", "grades")], unique: [["yearId", "gradeId", "name"]] },
  subjects: { schoolAdmin: true, named: true, fields: [{ key: "code" }], unique: [["code"]] },
  assignments: { schoolAdmin: true, fields: [ref("sectionId", "sections"), ref("subjectId", "subjects"), ref("teacherId", "users", false, "TEACHER")], unique: [["sectionId", "subjectId"]] },
  enrollments: { schoolAdmin: true, fields: [ref("sectionId", "sections"), ref("studentId", "users", false, "STUDENT")], unique: [["sectionId", "studentId"]] },
  links: { schoolAdmin: true, fields: [ref("parentId", "users", false, "PARENT"), ref("studentId", "users", false, "STUDENT")], unique: [["parentId", "studentId"]] },
  units: { teacher: true, named: true, fields: [ref("assignmentId", "assignments"), { key: "order", type: "number" }] },
  lessons: { teacher: true, named: true, fields: [ref("unitId", "units"), { key: "body", type: "long" }, { key: "order", type: "number" }] },
  resources: { teacher: true, named: true, fields: [ref("lessonId", "lessons"), choice("type", ["link", "file"]), { key: "url", optional: true }, { key: "filename", optional: true }, { key: "size", type: "number", optional: true }] },
  banks: { teacher: true, named: true, fields: [ref("assignmentId", "assignments")] },
  questions: { teacher: true, named: true, fields: [ref("bankId", "banks"), choice("type", ["mcq", "boolean", "short"]), { key: "choices", type: "long", optional: true }, { key: "correct" }, { key: "points", type: "number" }] },
  assessments: { teacher: true, named: true, fields: [ref("assignmentId", "assignments"), choice("type", ["assignment", "exam"]), { key: "instructions", type: "long" }, { key: "opensAt", type: "date" }, { key: "dueAt", type: "date" }] },
  assessmentQuestions: { teacher: true, fields: [ref("assessmentId", "assessments"), ref("questionId", "questions"), { key: "order", type: "number" }], unique: [["assessmentId", "questionId"]] },
  submissions: { teacher: true, readonly: true, fields: [ref("assessmentId", "assessments"), ref("studentId", "users", false, "STUDENT"), { key: "submittedAt", type: "date" }] },
  answers: { teacher: true, readonly: true, fields: [ref("submissionId", "submissions"), ref("questionId", "questions"), { key: "response", type: "long" }, { key: "filename", optional: true }] },
  scores: { teacher: true, readonly: true, fields: [ref("submissionId", "submissions"), ref("questionId", "questions"), { key: "points", type: "number" }, { key: "feedback", type: "long", optional: true }] },
  announcements: { schoolAdmin: true, teacher: true, named: true, fields: [ref("assignmentId", "assignments", true), choice("audience", ["all", "TEACHER", "STUDENT", "PARENT"]), { key: "body", type: "long" }] },
  notifications: { schoolAdmin: true, teacher: true, readonly: true, fields: [{ key: "body", type: "long", optional: true }, { key: "at", type: "date" }, { key: "readAt", type: "date", optional: true }] },
  preferences: { schoolAdmin: true, fields: [ref("currentYearId", "years")], unique: [["schoolId"]] },
};
export const academicKinds: Kind[] = ["years", "semesters", "grades", "sections", "subjects", "assignments", "enrollments", "preferences"];
export const schoolNav = ["dashboard", "memberships", "academics", "links", "announcements", "notifications", "settings", "transfer"];
export const teacherNav = ["dashboard", "classes", "units", "lessons", "resources", "banks", "questions", "assessments", "submissions", "gradebook", "announcements", "notifications", "transfer"];
export function isKind(value: string): value is Kind { return Object.prototype.hasOwnProperty.call(schema, value); }
