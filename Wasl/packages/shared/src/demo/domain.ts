import { DemoError, kinds } from "./model";
import type { StaffCommand as Command, DemoRecord, Kind, RecordInput, Session, Snapshot } from "./model";
import { schema } from "./schema";

export const uid = () => `demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const get = (s: Snapshot, kind: Kind, id: string) => s.records[kind].find(r => r.id === id);
export const hasRole = (s: Snapshot, schoolId: string, userId: string, role: string, active = true) => s.records.memberships.some(m => m.schoolId === schoolId && m.values.userId === userId && m.values.role === role && (!active || m.active));
export function context(s: Snapshot, session: Session) {
  const membership = get(s, "memberships", session.membershipId);
  const user = membership && get(s, "users", membership.values.userId);
  const school = membership && s.schools.find(v => v.id === membership.schoolId);
  if (!membership?.active || !user?.active || !school || !["SCHOOL_ADMIN", "TEACHER"].includes(membership.values.role)) throw new DemoError("unavailable");
  if (!school.active) throw new DemoError("suspended");
  return { membership, user, school, admin: membership.values.role === "SCHOOL_ADMIN" };
}
export function classId(s: Snapshot, kind: Kind, row: DemoRecord): string | undefined {
  const v = row.values;
  if (kind === "assignments") return row.id;
  if (["units", "banks", "assessments", "announcements"].includes(kind)) return v.assignmentId || undefined;
  if (kind === "lessons") { const parent = get(s, "units", v.unitId); return parent?.values.assignmentId; }
  if (kind === "resources") { const parent = get(s, "lessons", v.lessonId); return parent && classId(s, "lessons", parent); }
  if (kind === "questions") { const parent = get(s, "banks", v.bankId); return parent?.values.assignmentId; }
  if (kind === "assessmentQuestions" || kind === "submissions") { const parent = get(s, "assessments", v.assessmentId); return parent?.values.assignmentId; }
  if (kind === "answers" || kind === "scores") { const parent = get(s, "submissions", v.submissionId); return parent && classId(s, "submissions", parent); }
  return undefined;
}
export function classAvailable(s: Snapshot, assignment: DemoRecord) {
  const section = get(s, "sections", assignment.values.sectionId);
  return assignment.active && !!section?.active && !!get(s, "years", section.values.yearId)?.active && !!get(s, "grades", section.values.gradeId)?.active && !!get(s, "subjects", assignment.values.subjectId)?.active;
}
export function visible(s: Snapshot, session: Session, kind: Kind): DemoRecord[] {
  const { membership: m, user, school, admin } = context(s, session);
  const own = s.records.assignments.filter(a => a.schoolId === school.id && a.values.teacherId === user.id && classAvailable(s, a));
  const assignments = new Set(own.map(a => a.id));
  const sections = new Set(own.map(a => a.values.sectionId));
  if (kind === "users") {
    const ids = new Set(s.records.memberships.filter(r => r.schoolId === school.id).map(r => r.values.userId));
    if (!admin) {
      ids.clear(); ids.add(user.id);
      s.records.enrollments.filter(e => sections.has(e.values.sectionId)).forEach(e => ids.add(e.values.studentId));
      s.records.submissions.filter(sub => assignments.has(classId(s, "submissions", sub) ?? "")).forEach(sub => ids.add(sub.values.studentId));
    }
    return s.records.users.filter(r => ids.has(r.id));
  }
  return s.records[kind].filter(r => {
    if (r.schoolId !== school.id) return false;
    if (kind === "notifications") return r.values.recipientId === user.id;
    if (kind === "announcements") return admin || (r.values.authorId === user.id && (!r.values.assignmentId || assignments.has(r.values.assignmentId))) || (r.active && r.values.status === "published" && (r.values.audience === "all" || r.values.audience === m.values.role) && (!r.values.assignmentId || assignments.has(r.values.assignmentId)));
    if (admin) return !!schema[kind].schoolAdmin || ["assignments", "sections", "subjects"].includes(kind);
    if (kind === "memberships") return r.id === m.id;
    if (kind === "sections") return sections.has(r.id);
    if (kind === "subjects") return own.some(a => a.values.subjectId === r.id);
    if (kind === "years" || kind === "grades") return own.some(a => get(s, "sections", a.values.sectionId)?.values[kind === "years" ? "yearId" : "gradeId"] === r.id);
    if (kind === "enrollments") return sections.has(r.values.sectionId);
    const assignment = classId(s, kind, r);
    return !!assignment && assignments.has(assignment);
  });
}
export function allowed(s: Snapshot, session: Session, kind: Kind, id: string): DemoRecord {
  const row = visible(s, session, kind).find(r => r.id === id);
  if (!row) throw new DemoError("unavailable");
  return row;
}
export function displayRecord(s: Snapshot, kind: Kind, row: DemoRecord, ar: boolean): string {
  const name = (r?: DemoRecord) => r ? ar ? r.nameAr : r.name : "—";
  const v = row.values;
  if (kind === "memberships") return name(get(s, "users", v.userId));
  if (kind === "assignments") return `${name(get(s, "sections", v.sectionId))} · ${name(get(s, "subjects", v.subjectId))}`;
  if (kind === "enrollments") return `${name(get(s, "users", v.studentId))} · ${name(get(s, "sections", v.sectionId))}`;
  if (kind === "links") return `${name(get(s, "users", v.parentId))} → ${name(get(s, "users", v.studentId))}`;
  if (kind === "assessmentQuestions") return name(get(s, "questions", v.questionId));
  if (kind === "preferences") return name(get(s, "years", v.currentYearId));
  if (kind === "sections") return `${name(row)} · ${name(get(s, "years", v.yearId))}`;
  if (kind === "submissions") return `${name(get(s, "users", v.studentId))} · ${name(get(s, "assessments", v.assessmentId))}`;
  return name(row);
}
export function recordStatus(kind: Kind, row: DemoRecord) { return !row.active ? "inactive" : kind === "notifications" ? row.values.readAt ? "read" : "unread" : row.values.status ?? "active"; }
export function questionRows(s: Snapshot, assessmentId: string) {
  return s.records.assessmentQuestions.filter(a => a.active && a.values.assessmentId === assessmentId).sort((a, b) => Number(a.values.order) - Number(b.values.order)).map(a => get(s, "questions", a.values.questionId)).filter((q): q is DemoRecord => !!q);
}
export const totalMarks = (s: Snapshot, assessmentId: string) => questionRows(s, assessmentId).reduce((sum, q) => sum + Number(q.values.points), 0);
export function gradingValues(s: Snapshot, submission: DemoRecord) {
  let drafts: { questionId: string; score: string; feedback: string }[] = [];
  try { const parsed: unknown = JSON.parse(submission.values.gradingDraft ?? "[]"); if (Array.isArray(parsed)) drafts = parsed.filter(g => g && typeof g.questionId === "string" && typeof g.score === "string" && typeof g.feedback === "string"); } catch { /* Actual scores remain the source of truth when no draft is available. */ }
  return questionRows(s, submission.values.assessmentId).map(q => {
    const draft = drafts.find(g => g.questionId === q.id); const score = s.records.scores.find(g => g.values.submissionId === submission.id && g.values.questionId === q.id);
    return { questionId: q.id, score: draft?.score ?? score?.values.points ?? "", feedback: draft?.feedback ?? score?.values.feedback ?? "" };
  });
}
export function resultTotal(s: Snapshot, submissionId: string): number | undefined {
  const sub = get(s, "submissions", submissionId);
  if (!sub) return undefined;
  const qs = questionRows(s, sub.values.assessmentId);
  const scores = s.records.scores.filter(g => g.values.submissionId === submissionId);
  if (!qs.length || qs.some(q => !scores.some(g => g.values.questionId === q.id))) return undefined;
  return qs.reduce((sum, q) => sum + Number(scores.find(g => g.values.questionId === q.id)!.values.points), 0);
}
export function options(s: Snapshot, session: Session, kind: Kind, field: string, editingId?: string) {
  const def = schema[kind].fields.find(f => f.key === field);
  if (!def?.ref) return [];
  const { school, admin } = context(s, session);
  if (def.ref === "users") {
    if (kind === "memberships") return s.records.users.filter(u => u.active);
    return s.records.users.filter(u => u.active && hasRole(s, school.id, u.id, def.role ?? "TEACHER"));
  }
  return visible(s, session, def.ref).filter(r => r.active && (admin || def.ref !== "announcements" || r.values.authorId === context(s, session).user.id || r.id === editingId));
}
function fail(code: string, field?: string): never { throw new DemoError(code, field); }
const same = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
export function isoDate(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/.test(v) || !Number.isFinite(Date.parse(v))) return false;
  const [year, month, day] = v.slice(0, 10).split("-").map(Number); const calendar = new Date(Date.UTC(year, month - 1, day));
  return calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day;
}
export function validateInput(s: Snapshot, session: Session, kind: Kind, input: RecordInput, id?: string) {
  const { school, admin, user } = context(s, session);
  const definition = schema[kind];
  if (definition.readonly || !(admin ? definition.schoolAdmin : definition.teacher)) fail("unavailable");
  const previous = id ? allowed(s, session, kind, id) : undefined;
  if (previous && !previous.active) fail("locked");
  if (kind === "memberships" && previous?.values.role === "SCHOOL_ADMIN") fail("locked");
  if (previous && ["published", "closed", "released"].includes(previous.values.status)) fail("locked");
  if (kind === "announcements" && previous?.values.authorId !== undefined && previous.values.authorId !== user.id) fail("unavailable");
  if (kind === "questions" && id && s.records.assessmentQuestions.some(a => a.values.questionId === id && get(s, "assessments", a.values.assessmentId)?.values.status !== "draft")) fail("locked");
  if (kind === "assessmentQuestions" && previous && get(s, "assessments", previous.values.assessmentId)?.values.status !== "draft") fail("locked");
  if (definition.named && !(kind === "memberships" && input.values.userId)) {
    if (!input.name.trim()) fail("required", "name");
    if (!input.nameAr.trim()) fail("required", "nameAr");
  }
  for (const f of definition.fields) {
    const value = input.values[f.key]?.trim() ?? "";
    if (!value && !f.optional) fail("required", f.key);
    if (!value) continue;
    if (f.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) fail("invalidEmail", f.key);
    if (f.type === "number" && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100000 || (f.key !== "points" && !Number.isInteger(Number(value))))) fail("invalidNumber", f.key);
    if (f.type === "date" && !isoDate(value)) fail("invalidDate", f.key);
    if (["opensAt", "dueAt"].includes(f.key) && !/(Z|[+-]\d{2}:\d{2})$/.test(value)) fail("invalidDate", f.key);
    if (f.options && !f.options.includes(value)) fail("invalidRelation", f.key);
    if (f.ref) {
      const target = get(s, f.ref, value);
      if (!target?.active || (f.ref !== "users" && target.schoolId !== school.id)) fail("invalidRelation", f.key);
      if (f.ref === "users") {
        if (kind !== "memberships" && !hasRole(s, school.id, value, f.role ?? "TEACHER")) fail("invalidRelation", f.key);
      } else if (!visible(s, session, f.ref).some(r => r.id === value) || f.ref === "assignments" && !classAvailable(s, target)) fail("invalidRelation", f.key);
    }
  }
  const v = input.values;
  if (kind === "memberships" && previous && (v.userId !== previous.values.userId || v.role !== previous.values.role)) {
    const keys = previous.values.role === "TEACHER" ? ["teacherId"] : previous.values.role === "STUDENT" ? ["studentId"] : ["parentId"];
    if (kinds.some(k => s.records[k].some(r => r.schoolId === school.id && keys.some(key => r.values[key] === previous.values.userId)))) fail("locked", "role");
    if (previous.values.role === "STUDENT" && s.answerDrafts.some(d => d.schoolId === school.id && d.studentId === previous.values.userId)) fail("locked", "role");
  }
  for (const keys of definition.unique ?? []) {
    if (s.records[kind].some(r => r.id !== id && r.schoolId === school.id && keys.every(k => same(k === "name" ? input.name : k === "schoolId" ? school.id : v[k] ?? "", k === "name" ? r.name : k === "schoolId" ? r.schoolId : r.values[k] ?? "")))) fail("duplicate");
  }
  if (["years", "semesters"].includes(kind)) {
    if (Date.parse(v.startDate) >= Date.parse(v.endDate)) fail("invalidDate", "endDate");
    if (kind === "semesters") { const year = get(s, "years", v.yearId)!; if (Date.parse(v.startDate) < Date.parse(year.values.startDate) || Date.parse(v.endDate) > Date.parse(year.values.endDate)) fail("invalidDate", "startDate"); }
    if (id && kind === "years" && s.records.semesters.some(r => r.values.yearId === id && (Date.parse(r.values.startDate) < Date.parse(v.startDate) || Date.parse(r.values.endDate) > Date.parse(v.endDate)))) fail("invalidDate", "endDate");
  }
  if (kind === "enrollments") {
    const section = get(s, "sections", v.sectionId)!;
    if (!get(s, "years", section.values.yearId)?.active) fail("invalidRelation", "sectionId");
    if (s.records.enrollments.some(e => e.active && e.id !== id && e.schoolId === school.id && e.values.studentId === v.studentId && get(s, "sections", e.values.sectionId)?.values.yearId === section.values.yearId)) fail("duplicate", "studentId");
    if (previous && (previous.values.studentId !== v.studentId || previous.values.sectionId !== v.sectionId) && s.records.submissions.some(sub => sub.values.studentId === previous.values.studentId && get(s, "assignments", get(s, "assessments", sub.values.assessmentId)!.values.assignmentId)?.values.sectionId === previous.values.sectionId)) fail("locked");
    if (previous && (previous.values.studentId !== v.studentId || previous.values.sectionId !== v.sectionId) && s.answerDrafts.some(d => d.studentId === previous.values.studentId && get(s, "assignments", get(s, "assessments", d.assessmentId)!.values.assignmentId)?.values.sectionId === previous.values.sectionId)) fail("locked");
  }
  if (previous && ["units", "banks"].includes(kind) && previous.values.assignmentId !== v.assignmentId && s.records[kind === "units" ? "lessons" : "questions"].some(r => r.values[kind === "units" ? "unitId" : "bankId"] === id)) fail("locked");
  if (kind === "sections" && previous && (previous.values.yearId !== v.yearId || previous.values.gradeId !== v.gradeId) && (s.records.enrollments.some(e => e.values.sectionId === id) || s.records.assignments.some(a => a.values.sectionId === id))) fail("locked");
  if (kind === "assignments" && previous && (previous.values.sectionId !== v.sectionId || previous.values.subjectId !== v.subjectId) && (s.records.units.some(e => e.values.assignmentId === id) || s.records.assessments.some(e => e.values.assignmentId === id))) fail("locked");
  if (kind === "resources") {
    if (v.type === "link") { try { const url = new URL(v.url); if (url.protocol !== "https:" || url.username || url.password) fail("invalidUrl", "url"); } catch { fail("invalidUrl", "url"); } }
    else if (!v.filename?.trim() || !v.size?.trim()) fail("required", "filename");
    const lesson = get(s, "lessons", v.lessonId)!; if (lesson.values.status !== "draft") fail("locked");
  }
  if (kind === "questions") {
    const choices = (v.choices ?? "").split("\n").map(c => c.trim()).filter(Boolean);
    if (!(Number(v.points) > 0) || (v.type === "mcq" && (choices.length < 2 || new Set(choices).size !== choices.length || !choices.includes(v.correct.trim()))) || (v.type === "boolean" && !["true", "false"].includes(v.correct.trim()))) fail("invalidQuestion", "correct");
  }
  if (kind === "assessments") {
    if (Date.parse(v.opensAt) >= Date.parse(v.dueAt)) fail("invalidDate", "dueAt");
    if (previous && previous.values.assignmentId !== v.assignmentId && s.records.assessmentQuestions.some(q => q.values.assessmentId === id)) fail("locked");
  }
  if (kind === "assessmentQuestions") {
    const assessment = get(s, "assessments", v.assessmentId)!;
    const q = get(s, "questions", v.questionId)!;
    if (assessment.values.status !== "draft") fail("locked");
    if (classId(s, "questions", q) !== assessment.values.assignmentId) fail("invalidRelation", "questionId");
    if (!get(s, "banks", q.values.bankId)?.active) fail("invalidRelation", "questionId");
  }
  if (kind === "announcements" && !admin && !v.assignmentId) fail("required", "assignmentId");
  return previous;
}
function addEvent(s: Snapshot, session: Session, kind: Kind, row: DemoRecord, verb: string) {
  const { user } = context(s, session);
  s.events.unshift({ id: uid(), schoolId: row.schoolId, actorId: user.id, kind, recordId: row.id, verb, at: new Date().toISOString() });
}
export function appendNotifications(s: Snapshot, schoolId: string, kind: Kind, row: DemoRecord, recipientIds: Iterable<string>, body = "") {
  for (const recipientId of new Set(recipientIds)) {
    if (!s.records.memberships.some(m => m.active && m.schoolId === schoolId && m.values.userId === recipientId) || !get(s, "users", recipientId)?.active) continue;
    s.records.notifications.unshift({ id: uid(), schoolId, name: row.name, nameAr: row.nameAr, active: true, values: { recipientId, targetKind: kind, targetId: row.id, body, at: new Date().toISOString(), readAt: "" } });
  }
}
function notify(s: Snapshot, session: Session, kind: Kind, row: DemoRecord, recipientIds?: string[]) {
  const { school, user } = context(s, session);
  const assignmentId = classId(s, kind, row);
  const assignment = assignmentId ? get(s, "assignments", assignmentId) : undefined;
  const students = new Set(s.records.enrollments.filter(e => e.active && e.schoolId === school.id && (!assignment || e.values.sectionId === assignment.values.sectionId)).map(e => e.values.studentId));
  const parentIds = new Set(s.records.links.filter(l => l.active && l.schoolId === school.id && l.values.status === "approved" && students.has(l.values.studentId)).map(l => l.values.parentId));
  const recipients = new Set(recipientIds ?? s.records.memberships.filter(m => m.active && m.schoolId === school.id && m.values.userId !== user.id && (kind !== "announcements" || row.values.audience === "all" || row.values.audience === m.values.role) && (!assignment || m.values.userId === assignment.values.teacherId || students.has(m.values.userId) || parentIds.has(m.values.userId))).map(m => m.values.userId));
  appendNotifications(s, school.id, kind, row, recipients, row.values.body ?? row.values.instructions ?? "");
}
export function synchronizeCounts(s: Snapshot) {
  for (const school of s.schools) {
    school.demo.students = new Set(s.records.memberships.filter(m => m.active && m.schoolId === school.id && m.values.role === "STUDENT").map(m => m.values.userId)).size;
    school.demo.teachers = new Set(s.records.memberships.filter(m => m.active && m.schoolId === school.id && m.values.role === "TEACHER").map(m => m.values.userId)).size;
  }
}
export function addSchoolAdministrator(s: Snapshot, schoolId: string) {
  const school = s.schools.find(r => r.id === schoolId)!;
  const user: DemoRecord = { id: uid(), schoolId: "", active: true, name: school.demo.administrator, nameAr: school.demo.administratorAr, values: { email: school.demo.email } };
  const existing = s.records.users.find(u => same(u.values.email, user.values.email));
  if (!existing) s.records.users.push(user);
  s.records.memberships.push({ id: uid(), schoolId, active: true, name: user.name, nameAr: user.nameAr, values: { userId: existing?.id ?? user.id, role: "SCHOOL_ADMIN" } });
}
export function execute(source: Snapshot, session: Session, command: Command): { state: Snapshot; record?: DemoRecord } {
  const s = clone(source);
  const { school, user, admin } = context(s, session);
  if (command.type === "schoolProfile") {
    if (!admin) fail("unavailable");
    const v = command.input;
    for (const field of ["name", "nameAr", "city", "cityAr"]) if (!v[field]?.trim()) fail("required", field);
    if (!["ar", "en"].includes(v.locale)) fail("invalidRelation", "locale");
    school.name = v.name.trim(); school.nameAr = v.nameAr.trim(); school.locale = v.locale as "ar" | "en"; school.demo.city = v.city.trim(); school.demo.cityAr = v.cityAr.trim();
    s.activity.unshift({ id: uid(), schoolId: school.id, action: "edited", actor: user.name, actorAr: user.nameAr, at: new Date().toISOString() });
    return { state: s };
  }
  if (command.type === "save") {
    const { kind, id } = command;
    const input = clone(command.input);
    const previous = validateInput(s, session, kind, input, id);
    if (kind === "memberships") {
      const email = input.values.email?.trim().toLowerCase();
      let person = input.values.userId ? get(s, "users", input.values.userId) : email ? s.records.users.find(u => same(u.values.email, email)) : undefined;
      if (!person && !email) fail("required", "email");
      if (person && s.records.memberships.some(m => m.id !== id && m.schoolId === school.id && m.values.userId === person.id && m.values.role === input.values.role)) fail("duplicate");
      if (!person) { person = { id: uid(), schoolId: "", active: true, name: input.name.trim(), nameAr: input.nameAr.trim(), values: { email: email! } }; s.records.users.push(person); }
      else if (previous?.values.userId === person.id && input.name.trim() && input.nameAr.trim()) {
        person.name = input.name.trim(); person.nameAr = input.nameAr.trim();
        if (email && s.records.users.some(u => u.id !== person!.id && same(u.values.email, email))) fail("duplicate", "email");
        if (email) person.values.email = email;
      }
      input.values.userId = person.id; delete input.values.email;
      input.name = person.name; input.nameAr = person.nameAr;
    }
    const values = Object.fromEntries(schema[kind].fields.map(f => [f.key, input.values[f.key]?.trim() ?? ""]));
    const row: DemoRecord = { id: id ?? uid(), schoolId: school.id, name: input.name.trim() || kind, nameAr: input.nameAr.trim() || kind, active: previous?.active ?? true, values: { ...previous?.values, ...values } };
    if (["lessons", "assessments", "announcements"].includes(kind) && !previous) row.values.status = "draft";
    if (kind === "links" && (!previous || previous.values.parentId !== row.values.parentId || previous.values.studentId !== row.values.studentId)) row.values.status = "pending";
    if (kind === "announcements" || kind === "banks") row.values[kind === "banks" ? "ownerId" : "authorId"] = previous?.values[kind === "banks" ? "ownerId" : "authorId"] ?? user.id;
    if (id) s.records[kind] = s.records[kind].map(r => r.id === id ? row : r); else s.records[kind].unshift(row);
    // Identity changes remain consistent wherever this person appears.
    if (kind === "memberships") for (const targetSchool of s.schools) {
      if (s.records.memberships.some(m => m.schoolId === targetSchool.id && m.values.userId === row.values.userId && m.values.role === "SCHOOL_ADMIN") && same(targetSchool.demo.email, source.records.users.find(u => u.id === row.values.userId)?.values.email ?? "")) {
        const person = get(s, "users", row.values.userId)!; targetSchool.demo.administrator = person.name; targetSchool.demo.administratorAr = person.nameAr; targetSchool.demo.email = person.values.email;
      }
    }
    addEvent(s, session, kind, row, previous ? "edit" : "create"); synchronizeCounts(s);
    return { state: s, record: row };
  }
  if (command.type === "grade") {
    if (admin) fail("unavailable");
    const row = allowed(s, session, "submissions", command.id);
    if (row.values.status === "released") fail("locked");
    const qs = questionRows(s, row.values.assessmentId);
    if (command.scores.length !== qs.length || new Set(command.scores.map(g => g.questionId)).size !== qs.length) fail("incomplete");
    row.values.gradingDraft = JSON.stringify(command.scores);
    for (const q of qs) {
      const grade = command.scores.find(g => g.questionId === q.id);
      if (!grade) fail("incomplete");
      if (!grade.score.trim()) { s.records.scores = s.records.scores.filter(g => g.values.submissionId !== row.id || g.values.questionId !== q.id); continue; }
      if (!Number.isFinite(Number(grade.score)) || Number(grade.score) < 0 || Number(grade.score) > Number(q.values.points)) fail("invalidNumber", q.id);
      const old = s.records.scores.find(g => g.values.submissionId === row.id && g.values.questionId === q.id);
      const score: DemoRecord = { id: old?.id ?? uid(), schoolId: school.id, name: q.name, nameAr: q.nameAr, active: true, values: { submissionId: row.id, questionId: q.id, points: grade.score, feedback: grade.feedback, gradedBy: user.id, gradedAt: new Date().toISOString() } };
      if (old) s.records.scores = s.records.scores.map(g => g.id === old.id ? score : g); else s.records.scores.push(score);
    }
    row.values.status = resultTotal(s, row.id) === undefined ? "grading" : "graded"; addEvent(s, session, "submissions", row, "grade"); return { state: s, record: row };
  }
  const { kind, id, verb } = command;
  const row = allowed(s, session, kind, id);
  if (kind === "notifications" && ["read", "unread"].includes(verb)) { row.values.readAt = verb === "read" ? new Date().toISOString() : ""; return { state: s, record: row }; }
  if (kind === "submissions" && verb === "release") {
    if (admin || row.values.status !== "graded" || resultTotal(s, row.id) === undefined) fail("incomplete");
    row.values.status = "released"; row.values.releasedAt = new Date().toISOString();
    for (const score of s.records.scores.filter(g => g.values.submissionId === id)) score.values.releasedAt = row.values.releasedAt;
    const parentIds = s.records.links.filter(l => l.schoolId === school.id && l.active && l.values.studentId === row.values.studentId && l.values.status === "approved").map(l => l.values.parentId);
    notify(s, session, kind, row, [row.values.studentId, ...parentIds]); addEvent(s, session, kind, row, "release"); return { state: s, record: row };
  }
  if (!(admin ? schema[kind].schoolAdmin : schema[kind].teacher) || schema[kind].readonly) fail("unavailable");
  if (kind === "announcements" && row.values.authorId !== user.id) fail("unavailable");
  if (verb === "archive" || verb === "activate") {
    if (kind === "memberships" && row.values.role === "SCHOOL_ADMIN") fail("locked");
    if (verb === "archive" && ["years", "grades", "sections", "subjects"].includes(kind)) {
      const dependent = kinds.some(k => schema[k].fields.some(f => f.ref === kind && s.records[k].some(r => r.active && r.values[f.key] === row.id)));
      if (dependent) fail("locked");
    }
    if (kind === "resources" && get(s, "lessons", row.values.lessonId)?.values.status !== "draft") fail("locked");
    if (kind === "assessmentQuestions" && get(s, "assessments", row.values.assessmentId)?.values.status !== "draft") fail("locked");
    if (kind === "questions" && s.records.assessmentQuestions.some(a => a.values.questionId === row.id && get(s, "assessments", a.values.assessmentId)?.values.status !== "draft")) fail("locked");
    if (verb === "activate") {
      // Re-check relationships and uniqueness without editing historical content.
      const check = clone(s); const record = get(check, kind, id)!; record.active = true;
      const status = record.values.status; delete record.values.status;
      validateInput(check, session, kind, { name: record.name, nameAr: record.nameAr, values: record.values }, id);
      if (status) record.values.status = status;
    }
    row.active = verb === "activate";
  } else if (verb === "approve" || verb === "revoke") {
    if (kind !== "links" || !admin || !row.active) fail("unavailable");
    if (!hasRole(s, school.id, row.values.parentId, "PARENT") || !hasRole(s, school.id, row.values.studentId, "STUDENT")) fail("invalidRelation");
    row.values.status = verb === "approve" ? "approved" : "revoked";
  } else if (verb === "publish") {
    if (!["lessons", "assessments", "announcements"].includes(kind) || row.values.status !== "draft" || !row.active) fail("locked");
    validateInput(s, session, kind, { name: row.name, nameAr: row.nameAr, values: row.values }, row.id);
    if (kind === "assessments" && (!questionRows(s, id).length || Date.parse(row.values.dueAt) <= Date.now() || !(totalMarks(s, id) > 0))) fail("incomplete");
    row.values.status = "published"; row.values.publishedAt = new Date().toISOString(); notify(s, session, kind, row);
  } else if (verb === "close") {
    if (kind !== "assessments" || row.values.status !== "published") fail("locked");
    row.values.status = "closed";
  } else fail("unavailable");
  addEvent(s, session, kind, row, verb); synchronizeCounts(s); return { state: s, record: row };
}
