import { classId, context, displayRecord, get, hasRole, recordStatus, visible } from "./domain";
import type { DemoRecord, Kind, Locale, Session, Snapshot } from "./model";
import { academicKinds, isKind, schema, schoolNav, teacherNav } from "./schema";

export function pageKind(page: string): Kind | undefined {
  if (page === "classes") return "assignments";
  if (page === "gradebook") return "submissions";
  if (page === "academics") return "years";
  return isKind(page) ? page : undefined;
}
export function pageAllowed(s: Snapshot, session: Session, page: string) {
  const { admin } = context(s, session);
  if (["dashboard", "transfer"].includes(page)) return true;
  if (admin) return schoolNav.includes(page) || academicKinds.includes(page as Kind) || page === "users";
  return teacherNav.includes(page) || ["assignments", "assessmentQuestions", "users", "answers", "scores", "enrollments"].includes(page);
}
export function canCreate(s: Snapshot, session: Session, kind: Kind) {
  const { admin } = context(s, session);
  return !schema[kind].readonly && !!(admin ? schema[kind].schoolAdmin : schema[kind].teacher);
}
export function canEdit(s: Snapshot, session: Session, kind: Kind, row: DemoRecord) {
  if (!canCreate(s, session, kind) || !row.active || ["published", "closed", "released"].includes(row.values.status)) return false;
  if (kind === "memberships" && row.values.role === "SCHOOL_ADMIN") return false;
  if (kind === "announcements" && row.values.authorId !== context(s, session).user.id) return false;
  if (kind === "questions" && s.records.assessmentQuestions.some(a => a.values.questionId === row.id && get(s, "assessments", a.values.assessmentId)?.values.status !== "draft")) return false;
  if (kind === "assessmentQuestions" && get(s, "assessments", row.values.assessmentId)?.values.status !== "draft") return false;
  if (kind === "resources" && get(s, "lessons", row.values.lessonId)?.values.status !== "draft") return false;
  return true;
}
export function transitions(s: Snapshot, session: Session, kind: Kind, row: DemoRecord): string[] {
  if (kind === "notifications") return [row.values.readAt ? "unread" : "read"];
  if (kind === "submissions") return row.values.status === "graded" ? ["release"] : [];
  if (!canCreate(s, session, kind) || (kind === "memberships" && row.values.role === "SCHOOL_ADMIN") || (kind === "announcements" && row.values.authorId !== context(s, session).user.id)) return [];
  if (!row.active) return ["activate"];
  const actions = ["archive"];
  if (["lessons", "assessments", "announcements"].includes(kind) && row.values.status === "draft") actions.unshift("publish");
  if (kind === "assessments" && row.values.status === "published") actions.unshift("close");
  if (kind === "links") actions.unshift(row.values.status === "approved" ? "revoke" : "approve");
  return actions;
}
export interface Related { kind: Kind; rows: DemoRecord[]; title?: string }
export interface GradebookRow { student: DemoRecord; assignment: DemoRecord; assessment: DemoRecord; submission?: DemoRecord }
export function gradebook(s: Snapshot, session: Session, selectedClass = "", selectedAssessment = "", search = ""): GradebookRow[] {
  const classes = visible(s, session, "assignments").filter(c => !selectedClass || c.id === selectedClass);
  const assessments = visible(s, session, "assessments").filter(a => a.active && a.values.status !== "draft" && (!selectedAssessment || a.id === selectedAssessment));
  const enrollments = visible(s, session, "enrollments"); const submissions = visible(s, session, "submissions");
  const rows: GradebookRow[] = [];
  for (const assignment of classes) for (const assessment of assessments.filter(a => a.values.assignmentId === assignment.id)) {
    const studentIds = new Set(enrollments.filter(e => e.values.sectionId === assignment.values.sectionId && (e.active || submissions.some(sub => sub.values.assessmentId === assessment.id && sub.values.studentId === e.values.studentId))).map(e => e.values.studentId));
    for (const id of studentIds) {
      const student = get(s, "users", id)!;
      if (search && !`${student.name} ${student.nameAr}`.toLowerCase().includes(search.toLowerCase())) continue;
      rows.push({ student, assignment, assessment, submission: submissions.find(sub => sub.values.assessmentId === assessment.id && sub.values.studentId === id) });
    }
  }
  return rows;
}
export function related(s: Snapshot, session: Session, kind: Kind, row: DemoRecord): Related[] {
  const select = (target: Kind, predicate: (r: DemoRecord) => boolean, title?: string): Related => ({ kind: target, rows: visible(s, session, target).filter(predicate), title });
  const v = row.values;
  switch (kind) {
    case "assignments": return [select("enrollments", e => e.active && e.values.sectionId === v.sectionId && hasRole(s, row.schoolId, e.values.studentId, "STUDENT"), "roster"), select("units", r => r.values.assignmentId === row.id), select("lessons", r => classId(s, "lessons", r) === row.id), select("assessments", r => r.values.assignmentId === row.id), select("submissions", r => classId(s, "submissions", r) === row.id, "gradebook")];
    case "memberships": return [select("assignments", r => r.values.teacherId === v.userId), select("enrollments", r => r.values.studentId === v.userId), select("links", r => r.values.parentId === v.userId || r.values.studentId === v.userId)];
    case "users": return [select("enrollments", r => r.values.studentId === row.id)];
    case "sections": return [select("assignments", r => r.values.sectionId === row.id), select("enrollments", r => r.values.sectionId === row.id)];
    case "units": return [select("lessons", r => r.values.unitId === row.id)];
    case "lessons": return [select("resources", r => r.values.lessonId === row.id)];
    case "banks": return [select("questions", r => r.values.bankId === row.id)];
    case "assessments": return [select("assessmentQuestions", r => r.values.assessmentId === row.id), select("submissions", r => r.values.assessmentId === row.id)];
    case "submissions": return [select("answers", r => r.values.submissionId === row.id), select("scores", r => r.values.submissionId === row.id)];
    default: return [];
  }
}
export function filtered(s: Snapshot, session: Session, kind: Kind, locale: Locale, query: string, status: string, classFilter = "", roleFilter = "", assessmentFilter = "") {
  return visible(s, session, kind).filter(r => {
    if (status && recordStatus(kind, r) !== status) return false;
    if (roleFilter && r.values.role !== roleFilter) return false;
    if (classFilter && classId(s, kind, r) !== classFilter) return false;
    if (assessmentFilter && r.values.assessmentId !== assessmentFilter) return false;
    const search = query.trim().normalize("NFKC").toLocaleLowerCase(locale);
    const person = kind === "memberships" ? get(s, "users", r.values.userId) : undefined;
    return !search || [r.id, displayRecord(s, kind, r, false), displayRecord(s, kind, r, true), person?.values.email ?? ""].some(v => v.normalize("NFKC").toLocaleLowerCase(locale).includes(search));
  }).sort((a, b) => ["units", "lessons", "assessmentQuestions"].includes(kind) ? Number(a.values.order) - Number(b.values.order) : 0);
}
export function metrics(s: Snapshot, session: Session): { label: string; value: number; page: string }[] {
  const { admin } = context(s, session);
  if (admin) {
    const members = visible(s, session, "memberships").filter(m => m.active);
    const year = visible(s, session, "preferences").find(r => r.active)?.values.currentYearId;
    return [
      { label: "teachers", value: new Set(members.filter(m => m.values.role === "TEACHER").map(m => m.values.userId)).size, page: "memberships" },
      { label: "students", value: new Set(members.filter(m => m.values.role === "STUDENT").map(m => m.values.userId)).size, page: "enrollments" },
      { label: "sections", value: visible(s, session, "sections").filter(r => r.active && (!year || r.values.yearId === year)).length, page: "sections" },
      { label: "subjects", value: visible(s, session, "subjects").filter(r => r.active).length, page: "subjects" },
    ];
  }
  return [
    { label: "classes", value: visible(s, session, "assignments").length, page: "classes" },
    { label: "submissions", value: visible(s, session, "submissions").filter(r => ["ungraded", "grading"].includes(r.values.status)).length, page: "submissions" },
    { label: "draft", value: visible(s, session, "assessments").filter(r => r.active && r.values.status === "draft").length, page: "assessments" },
    { label: "announcements", value: visible(s, session, "announcements").filter(r => r.active && r.values.status === "published").length, page: "announcements" },
  ];
}
