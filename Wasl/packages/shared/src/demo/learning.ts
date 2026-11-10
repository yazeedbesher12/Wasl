import { appendNotifications, classAvailable, classId, clone, get, hasRole, questionRows, uid } from "./domain";
import { DemoError } from "./model";
import type { AnswerDraft, DemoRecord, LearningCommand, Session, Snapshot } from "./model";

export type LearningRole = "student" | "parent";
export interface NamedView { id: string; name: string; nameAr: string }
export interface PersonView extends NamedView { email: string }
export interface ChildView { linkId: string; student: NamedView; school: NamedView; enrollments: { section: NamedView; grade: NamedView; year: NamedView }[] }
export interface ClassView extends NamedView { subject: NamedView; teacher: NamedView; section: NamedView; grade: NamedView; year: NamedView; lessonCount: number; taskCount: number }
export interface ResourceView extends NamedView { lessonId: string; type: "link" | "file"; url?: string; filename?: string; size?: number }
export interface LessonView extends NamedView { classId: string; unit: NamedView; body: string; order: number; publishedAt?: string; resources: ResourceView[] }
export interface QuestionView extends NamedView { type: "mcq" | "boolean" | "short"; choices: string[]; points: number }
export type TaskStatus = "upcoming" | "submitted" | "late" | "missing" | "resultAvailable";
export interface ReceiptView extends NamedView { assessmentId: string; classId: string; submittedAt: string; stage: "awaitingGrading" | "awaitingRelease" | "released"; late: boolean; responses?: { question: QuestionView; response: string; filename?: string }[] }
export interface TaskView extends NamedView {
  classId: string; type: "assignment" | "exam"; instructions: string; opensAt: string; dueAt: string; maxMarks: number; questionCount: number;
  status: TaskStatus; window: "notOpen" | "open" | "deadlinePassed" | "assessmentClosed"; canAttempt: boolean;
  questions: QuestionView[]; receipt?: ReceiptView; draft?: AnswerDraft;
}
export interface ResultView extends NamedView { assessmentId: string; classId: string; releasedAt: string; submittedAt: string; earned: number; maximum: number; breakdown: { question: QuestionView; response: string; score: number; feedback: string }[] }
export interface AnnouncementView extends NamedView { body: string; classId?: string }
export interface LearningDestination { page: "lessons" | "resources" | "tasks" | "submissions" | "results" | "announcements"; id: string; childLinkId?: string }
export interface LearningNotification extends NamedView { at: string; read: boolean; body: string; available: boolean; destination?: LearningDestination; child?: NamedView; school: NamedView }
const named = (r: { id: string; name: string; nameAr: string }): NamedView => ({ id: r.id, name: r.name, nameAr: r.nameAr });
function unavailable(): never { throw new DemoError("unavailable"); }

/** Staff selectors intentionally still reject these roles. No raw values bags or
 * staff question/grade records may cross this Student/Parent view-model boundary. */
export function learningIdentity(s: Snapshot, session: Session) {
  const member = get(s, "memberships", session.membershipId);
  const user = member && get(s, "users", member.values.userId);
  if (!member?.active || !user?.active || !["STUDENT", "PARENT"].includes(member.values.role)) unavailable();
  const origin = s.schools.find(v => v.id === member.schoolId); if (!origin) unavailable();
  if (member.values.role === "STUDENT" && !origin.active) throw new DemoError("suspended");
  return { role: (member.values.role === "PARENT" ? "parent" : "student") as LearningRole, user: { ...named(user), email: user.values.email }, school: member.values.role === "STUDENT" ? named(origin) : undefined };
}
function studentEnrollments(s: Snapshot, schoolId: string, studentId: string) {
  return s.records.enrollments.filter(e => {
    if (!e.active || e.schoolId !== schoolId || e.values.studentId !== studentId) return false;
    const section = get(s, "sections", e.values.sectionId);
    return section?.active && get(s, "grades", section.values.gradeId)?.active && get(s, "years", section.values.yearId)?.active;
  });
}
function enrollmentViews(s: Snapshot, enrollments: DemoRecord[]) {
  return enrollments.map(e => { const section = get(s, "sections", e.values.sectionId)!; return { section: named(section), grade: named(get(s, "grades", section.values.gradeId)!), year: named(get(s, "years", section.values.yearId)!) }; });
}
export function learningChildren(s: Snapshot, session: Session): ChildView[] {
  const identity = learningIdentity(s, session); if (identity.role !== "parent") return [];
  return s.records.links.filter(l => l.active && l.values.status === "approved" && l.values.parentId === identity.user.id).flatMap(link => {
    const school = s.schools.find(v => v.id === link.schoolId); const student = get(s, "users", link.values.studentId);
    if (!school?.active || !student?.active || !hasRole(s, school.id, identity.user.id, "PARENT") || !hasRole(s, school.id, student.id, "STUDENT")) return [];
    return [{ linkId: link.id, student: named(student), school: named(school), enrollments: enrollmentViews(s, studentEnrollments(s, school.id, student.id)) }];
  });
}
function scope(s: Snapshot, session: Session) {
  const identity = learningIdentity(s, session); let schoolId: string; let studentId: string;
  if (identity.role === "student") { schoolId = identity.school!.id; studentId = identity.user.id; }
  else {
    if (!session.childLinkId) throw new DemoError("chooseChild");
    const link = get(s, "links", session.childLinkId);
    if (!link?.active || link.values.status !== "approved" || link.values.parentId !== identity.user.id) unavailable();
    schoolId = link.schoolId; studentId = link.values.studentId;
    if (!hasRole(s, schoolId, identity.user.id, "PARENT")) unavailable();
  }
  const school = s.schools.find(v => v.id === schoolId); const student = get(s, "users", studentId);
  if (!school || !student?.active || !hasRole(s, schoolId, studentId, "STUDENT")) unavailable();
  if (!school.active) throw new DemoError("suspended");
  const enrollments = studentEnrollments(s, schoolId, studentId); const sections = new Set(enrollments.map(e => e.values.sectionId));
  const classes = s.records.assignments.filter(a => a.schoolId === schoolId && sections.has(a.values.sectionId) && classAvailable(s, a) && hasRole(s, schoolId, a.values.teacherId, "TEACHER") && get(s, "users", a.values.teacherId)?.active);
  return { ...identity, school: named(school), student: named(student), enrollments, classes };
}
export function learningProfile(s: Snapshot, session: Session) {
  const identity = learningIdentity(s, session);
  if (identity.role === "parent") return { ...identity, children: learningChildren(s, session), enrollments: [] };
  const c = scope(s, session); return { ...identity, currentYear: currentYear(s, c), children: [], enrollments: enrollmentViews(s, c.enrollments) };
}
function currentYear(s: Snapshot, c: ReturnType<typeof scope>) {
  const preference = s.records.preferences.find(p => p.active && p.schoolId === c.school.id);
  const year = preference ? get(s, "years", preference.values.currentYearId) : c.enrollments[0] ? get(s, "years", get(s, "sections", c.enrollments[0].values.sectionId)!.values.yearId) : undefined;
  return year?.active ? named(year) : undefined;
}
export function learningContext(s: Snapshot, session: Session) {
  const c = scope(s, session); return { role: c.role, user: c.user, school: c.school, student: c.student, currentYear: currentYear(s, c), enrollments: enrollmentViews(s, c.enrollments) };
}
function lessonRows(s: Snapshot, classIds: Set<string>) {
  return s.records.lessons.filter(l => l.active && l.values.status === "published" && get(s, "units", l.values.unitId)?.active && classIds.has(classId(s, "lessons", l) ?? ""));
}
export function learningClasses(s: Snapshot, session: Session): ClassView[] {
  const c = scope(s, session);
  return c.classes.map(a => {
    const subject = get(s, "subjects", a.values.subjectId)!; const section = get(s, "sections", a.values.sectionId)!;
    return { ...named(subject), id: a.id, subject: named(subject), teacher: named(get(s, "users", a.values.teacherId)!), section: named(section), grade: named(get(s, "grades", section.values.gradeId)!), year: named(get(s, "years", section.values.yearId)!), lessonCount: lessonRows(s, new Set([a.id])).length, taskCount: s.records.assessments.filter(t => t.active && t.values.assignmentId === a.id && ["published", "closed"].includes(t.values.status)).length };
  });
}
function resourceView(r: DemoRecord): ResourceView | undefined {
  if (!r.active) return;
  if (r.values.type === "link") {
    try { const url = new URL(r.values.url); if (url.protocol !== "https:" || url.username || url.password) return; return { ...named(r), lessonId: r.values.lessonId, type: "link", url: url.href }; } catch { return; }
  }
  if (r.values.type === "file") return { ...named(r), lessonId: r.values.lessonId, type: "file", filename: r.values.filename, size: Number(r.values.size || 0) };
}
export function learningLessons(s: Snapshot, session: Session): LessonView[] {
  const c = scope(s, session); const classIds = new Set(c.classes.map(a => a.id));
  return lessonRows(s, classIds).map(l => ({ ...named(l), classId: classId(s, "lessons", l)!, unit: named(get(s, "units", l.values.unitId)!), body: l.values.body, order: Number(l.values.order), publishedAt: l.values.publishedAt, resources: s.records.resources.filter(r => r.values.lessonId === l.id).map(resourceView).filter((v): v is ResourceView => !!v) })).sort((a, b) => Number(get(s, "units", a.unit.id)?.values.order) - Number(get(s, "units", b.unit.id)?.values.order) || a.order - b.order);
}
function publicQuestion(q: DemoRecord): QuestionView {
  return { ...named(q), type: q.values.type as QuestionView["type"], choices: q.values.type === "mcq" ? (q.values.choices ?? "").split("\n").map(v => v.trim()).filter(Boolean) : [], points: Number(q.values.points) };
}
function released(s: Snapshot, sub: DemoRecord) {
  if (sub.values.status !== "released" || !Number.isFinite(Date.parse(sub.values.releasedAt ?? ""))) return false;
  const qs = questionRows(s, sub.values.assessmentId);
  return qs.length > 0 && qs.every(q => {
    const grade = s.records.scores.find(g => g.values.submissionId === sub.id && g.values.questionId === q.id);
    return !!grade && grade.values.releasedAt === sub.values.releasedAt && Number.isFinite(Number(grade.values.points)) && Number(grade.values.points) >= 0 && Number(grade.values.points) <= Number(q.values.points);
  });
}
function receipt(s: Snapshot, c: ReturnType<typeof scope>, sub: DemoRecord): ReceiptView {
  const a = get(s, "assessments", sub.values.assessmentId)!;
  const isReleased = released(s, sub);
  const showAnswers = c.role === "student" || isReleased;
  return { ...named(a), id: sub.id, assessmentId: a.id, classId: a.values.assignmentId, submittedAt: sub.values.submittedAt,
    stage: isReleased ? "released" : ["graded", "released"].includes(sub.values.status) ? "awaitingRelease" : "awaitingGrading",
    late: Date.parse(sub.values.submittedAt) > Date.parse(a.values.dueAt),
    ...(showAnswers ? { responses: questionRows(s, a.id).map(q => { const ans = s.records.answers.find(v => v.values.submissionId === sub.id && v.values.questionId === q.id); return { question: publicQuestion(q), response: ans?.values.response ?? "", filename: ans?.values.filename }; }) } : {}),
  };
}
export function learningTasks(s: Snapshot, session: Session, now = Date.now()): TaskView[] {
  const c = scope(s, session); const classIds = new Set(c.classes.map(a => a.id));
  return s.records.assessments.filter(a => a.active && classIds.has(a.values.assignmentId) && ["published", "closed"].includes(a.values.status)).map(a => {
    const sub = s.records.submissions.find(v => v.schoolId === c.school.id && v.values.studentId === c.student.id && v.values.assessmentId === a.id);
    const draft = c.role === "student" ? s.answerDrafts.find(d => d.studentId === c.student.id && d.assessmentId === a.id) : undefined;
    const window: TaskView["window"] = a.values.status === "closed" ? "assessmentClosed" : now < Date.parse(a.values.opensAt) ? "notOpen" : now >= Date.parse(a.values.dueAt) ? "deadlinePassed" : "open";
    const status: TaskStatus = sub && released(s, sub) ? "resultAvailable" : sub ? Date.parse(sub.values.submittedAt) > Date.parse(a.values.dueAt) ? "late" : "submitted" : ["assessmentClosed", "deadlinePassed"].includes(window) ? "missing" : "upcoming";
    // After closing, keep the already published questions readable so cached
    // answers remain inspectable. Only canAttempt permits writing or submission.
    const qs = questionRows(s, a.id); const canReadQuestions = c.role === "student" && now >= Date.parse(a.values.opensAt);
    return { ...named(a), classId: a.values.assignmentId, type: a.values.type as TaskView["type"], instructions: a.values.instructions, opensAt: a.values.opensAt, dueAt: a.values.dueAt, maxMarks: qs.reduce((n, q) => n + Number(q.values.points), 0), questionCount: qs.length, status, window, canAttempt: c.role === "student" && window === "open" && !sub && qs.length > 0, questions: canReadQuestions ? qs.map(publicQuestion) : [], ...(sub ? { receipt: receipt(s, c, sub) } : {}), ...(draft ? { draft: clone(draft) } : {}) };
  }).sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
}
export function learningReceipt(s: Snapshot, session: Session, id: string): ReceiptView {
  const found = learningTasks(s, session).find(t => t.receipt?.id === id)?.receipt; if (!found) unavailable(); return found;
}
export function learningResults(s: Snapshot, session: Session): ResultView[] {
  const tasks = learningTasks(s, session);
  return tasks.filter(t => t.receipt?.stage === "released").flatMap(t => {
    const sub = get(s, "submissions", t.receipt!.id)!;
    if (!sub.values.releasedAt || !Number.isFinite(Date.parse(sub.values.releasedAt))) return [];
    const qs = questionRows(s, t.id); const grades = qs.map(q => s.records.scores.find(g => g.values.submissionId === sub.id && g.values.questionId === q.id));
    if (!grades.length || grades.some(g => !g?.values.releasedAt || !Number.isFinite(Number(g.values.points)))) return [];
    const breakdown = qs.map((q, i) => ({ question: publicQuestion(q), response: s.records.answers.find(a => a.values.submissionId === sub.id && a.values.questionId === q.id)?.values.response ?? "", score: Number(grades[i]!.values.points), feedback: grades[i]!.values.feedback ?? "" }));
    return [{ ...named(t), id: sub.id, assessmentId: t.id, classId: t.classId, submittedAt: sub.values.submittedAt, releasedAt: sub.values.releasedAt, earned: breakdown.reduce((sum, g) => sum + g.score, 0), maximum: t.maxMarks, breakdown }];
  }).sort((a, b) => b.releasedAt.localeCompare(a.releasedAt));
}
export function learningAnnouncements(s: Snapshot, session: Session): AnnouncementView[] {
  const c = scope(s, session); const classes = new Set(c.classes.map(a => a.id)); const role = c.role === "parent" ? "PARENT" : "STUDENT";
  return s.records.announcements.filter(a => a.active && a.schoolId === c.school.id && a.values.status === "published" && ["all", role].includes(a.values.audience) && (!a.values.assignmentId || classes.has(a.values.assignmentId))).map(a => ({ ...named(a), body: a.values.body, ...(a.values.assignmentId ? { classId: a.values.assignmentId } : {}) }));
}
export function learningNotifications(s: Snapshot, session: Session): LearningNotification[] {
  const identity = learningIdentity(s, session);
  if (identity.role === "parent" && !session.childLinkId) return learningChildren(s, session).flatMap(child => learningNotifications(s, { ...session, childLinkId: child.linkId }));
  const c = scope(s, session); const tasks = learningTasks(s, session); const lessons = learningLessons(s, session); const announcements = learningAnnouncements(s, session);
  const results = new Set(learningResults(s, session).map(r => r.id));
  const rows: LearningNotification[] = [];
  for (const n of s.records.notifications.filter(n => n.active && n.schoolId === c.school.id && n.values.recipientId === c.user.id)) {
    const targetId = n.values.targetId; let target: NamedView | undefined; let page: LearningDestination["page"] | undefined; let body = "";
    if (n.values.targetKind === "lessons") { const l = lessons.find(l => l.id === targetId); target = l; page = l ? "lessons" : undefined; body = l?.body ?? ""; }
    else if (n.values.targetKind === "resources") { target = lessons.flatMap(l => l.resources).find(r => r.id === targetId); if (target) page = "resources"; }
    else if (n.values.targetKind === "assessments") { target = tasks.find(t => t.id === targetId); if (target) page = "tasks"; }
    else if (n.values.targetKind === "announcements") { const a = announcements.find(a => a.id === targetId); target = a; if (a) page = "announcements"; body = a?.body ?? ""; }
    else if (n.values.targetKind === "submissions") {
      const raw = get(s, "submissions", targetId);
      // A notification for a sibling is not an unavailable notification for this child.
      if (raw && raw.values.studentId !== c.student.id) continue;
      target = tasks.find(t => t.receipt?.id === targetId)?.receipt; if (target) page = results.has(targetId) ? "results" : "submissions";
    }
    // Omit notifications for other enrolled classes/audiences, while retaining a
    // generic unavailable row for removed/archived destinations without leaking text.
    if (!target) {
      const rawKind = n.values.targetKind;
      if (rawKind === "announcements") { const raw = get(s, "announcements", targetId); if (raw && !["all", c.role === "parent" ? "PARENT" : "STUDENT"].includes(raw.values.audience)) continue; }
    }
    rows.push({ id: n.id, name: target?.name ?? "", nameAr: target?.nameAr ?? "", at: n.values.at, read: !!n.values.readAt, body, available: !!page, ...(page ? { destination: { page, id: targetId, ...(c.role === "parent" ? { childLinkId: session.childLinkId } : {}) } } : {}), ...(c.role === "parent" ? { child: c.student } : {}), school: c.school });
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}
export function learningSummary(s: Snapshot, session: Session, now = Date.now()) {
  const tasks = learningTasks(s, session, now); const results = learningResults(s, session);
  return { pending: tasks.filter(t => !t.receipt).length, upcoming: tasks.filter(t => t.status === "upcoming"), submitted: tasks.filter(t => !!t.receipt).length, released: results.length, earned: results.reduce((n, r) => n + r.earned, 0), maximum: results.reduce((n, r) => n + r.maximum, 0) };
}
export const learningNav = (role: LearningRole) => role === "parent" ? ["children", "dashboard", "classes", "tasks", "results", "announcements", "notifications", "profile"] : ["dashboard", "classes", "lessons", "tasks", "results", "announcements", "notifications", "profile"];
export function learningPath(role: LearningRole, childLinkId: string | undefined, page: string, id?: string, attempt = false) {
  const root = role === "parent" && childLinkId && !["children", "profile", "transfer"].includes(page) ? `/parent/child/${childLinkId}` : `/${role}`;
  return `${root}/${page}${id ? `/${id}` : ""}${attempt ? "/attempt" : ""}`;
}
export function validateResponses(questions: QuestionView[], responses: Record<string, string>, final: boolean) {
  if (!responses || typeof responses !== "object" || Array.isArray(responses) || Object.keys(responses).some(id => !questions.some(q => q.id === id))) throw new DemoError("invalidAnswer");
  for (const q of questions) {
    const response = responses[q.id] ?? "";
    if (typeof response !== "string" || response.length > 10000) throw new DemoError("invalidAnswer", q.id);
    if (!response.trim()) { if (final) throw new DemoError("answerRequired", q.id); continue; }
    if (q.type === "mcq" && !q.choices.includes(response) || q.type === "boolean" && !["true", "false"].includes(response)) throw new DemoError("invalidAnswer", q.id);
  }
}
export function executeLearning(source: Snapshot, session: Session, command: LearningCommand): { state: Snapshot; record?: DemoRecord; draft?: AnswerDraft } {
  const s = clone(source); const identity = learningIdentity(s, session);
  if (command.type === "readLearningNotification") {
    if (!learningNotifications(s, session).some(n => n.id === command.id)) unavailable();
    const row = get(s, "notifications", command.id)!; row.values.readAt = command.read ? new Date().toISOString() : ""; return { state: s, record: row };
  }
  if (identity.role !== "student") unavailable();
  const c = scope(s, session); const task = learningTasks(s, session).find(t => t.id === command.assessmentId); if (!task) unavailable();
  if (task.receipt) throw new DemoError("alreadySubmitted");
  if (!task.canAttempt) throw new DemoError(task.window === "notOpen" ? "notOpen" : "attemptUnavailable");
  const previous = s.answerDrafts.find(d => d.studentId === c.student.id && d.assessmentId === task.id);
  if (!Number.isInteger(command.revision) || command.revision !== (previous?.revision ?? 0)) throw new DemoError("draftChanged");
  validateResponses(task.questions, command.responses, command.type === "submitAnswers");
  const responses = Object.fromEntries(task.questions.map(q => [q.id, command.responses[q.id] ?? ""]));
  if (command.type === "saveAnswers") {
    const draft: AnswerDraft = { id: previous?.id ?? uid(), schoolId: c.school.id, studentId: c.student.id, assessmentId: task.id, responses, revision: (previous?.revision ?? 0) + 1, updatedAt: new Date().toISOString() };
    s.answerDrafts = [...s.answerDrafts.filter(d => d.id !== draft.id), draft]; return { state: s, draft };
  }
  const row: DemoRecord = { id: uid(), schoolId: c.school.id, name: task.name, nameAr: task.nameAr, active: true, values: { assessmentId: task.id, studentId: c.student.id, submittedAt: new Date().toISOString(), status: "ungraded" } };
  s.records.submissions.unshift(row);
  for (const q of task.questions) s.records.answers.push({ id: uid(), schoolId: c.school.id, name: q.name, nameAr: q.nameAr, active: true, values: { submissionId: row.id, questionId: q.id, response: responses[q.id] } });
  s.answerDrafts = s.answerDrafts.filter(d => d.studentId !== c.student.id || d.assessmentId !== task.id);
  s.events.unshift({ id: uid(), schoolId: c.school.id, actorId: c.student.id, kind: "submissions", recordId: row.id, verb: "finalSubmit", at: row.values.submittedAt });
  const assignment = get(s, "assignments", task.classId)!;
  appendNotifications(s, c.school.id, "submissions", row, [assignment.values.teacherId, c.user.id]);
  return { state: s, record: row };
}
