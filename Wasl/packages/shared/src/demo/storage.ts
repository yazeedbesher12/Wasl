import { DemoError, kinds, STORAGE_KEY } from "./model";
import type { Action, AnswerDraft, Command, DemoRecord, Kind, LearningCommand, SchoolInput, Session, Snapshot, StorageAdapter } from "./model";
import { freshSnapshot, migrate } from "./fixtures";
import { validLegacy } from "./legacy";
import { addSchoolAdministrator, clone, execute, get, isoDate, synchronizeCounts, uid } from "./domain";
import { schema } from "./schema";
import { executeLearning, validateResponses } from "./learning";

const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const safeId = (v: string) => /^[A-Za-z0-9_-]+$/.test(v);
function assert(value: unknown): asserts value { if (!value) throw new DemoError("invalidSnapshot"); }
/** Portable tuple encoding avoids exhausting browser/Android storage with repeated
 * record property names. Export and persistence use the same versioned envelope. */
export function encode(s: Snapshot): string {
  return JSON.stringify({ ...s, format: "wasl-demo", records: Object.fromEntries(kinds.map(k => [k, s.records[k].map(r => [r.id, r.schoolId, r.name, r.nameAr, r.active, r.values])])) });
}
export function decode(raw: string): Snapshot {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new DemoError("invalidSnapshot"); }
  if (validLegacy(value)) { assert(!("records" in value) && value.schools.every(s => safeId(s.id))); return migrate(value); }
  assert(object(value) && (value.version === 2 || value.version === 3));
  const candidate = value as Record<string, unknown>;
  if (candidate.version === 2) { assert(!("answerDrafts" in candidate)); candidate.answerDrafts = []; candidate.version = 3; }
  assert(Array.isArray(candidate.answerDrafts));
  assert(object(candidate.records));
  if (candidate.format === "wasl-demo") {
    const tables = candidate.records as Record<string, unknown>;
    for (const kind of kinds) {
      assert(Array.isArray(tables[kind]));
      tables[kind] = (tables[kind] as unknown[]).map(tuple => {
        assert(Array.isArray(tuple) && tuple.length === 6);
        const [id, schoolId, name, nameAr, active, values] = tuple as unknown[];
        return { id, schoolId, name, nameAr, active, values };
      });
    }
  }
  // Reuse the existing complete school/activity validation without changing v1.
  assert(validLegacy({ ...candidate, version: 1 }));
  assert(Array.isArray(candidate.events));
  const records = candidate.records as Record<string, unknown>;
  const indexes = {} as Record<Kind, Map<string, DemoRecord>>;
  const schools = new Set((candidate.schools as Snapshot["schools"]).map(s => s.id));
  assert([...schools].every(safeId));
  for (const kind of kinds) {
    assert(Array.isArray(records[kind]));
    const index = new Map<string, DemoRecord>();
    for (const rawRow of records[kind] as unknown[]) {
      assert(object(rawRow));
      assert(["id", "schoolId", "name", "nameAr"].every(k => typeof rawRow[k] === "string"));
      assert(typeof rawRow.active === "boolean" && object(rawRow.values) && Object.values(rawRow.values).every(v => typeof v === "string"));
      const r = rawRow as unknown as DemoRecord;
      assert(safeId(r.id) && !index.has(r.id) && (kind === "users" ? r.schoolId === "" : schools.has(r.schoolId)));
      index.set(r.id, r);
    }
    indexes[kind] = index;
  }
  const s = candidate as unknown as Snapshot;
  const uniquePeople = new Set<string>();
  for (const u of s.records.users) { const email = u.values.email?.toLowerCase(); assert(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !uniquePeople.has(email)); uniquePeople.add(email); }
  for (const kind of kinds) {
    const unique = new Set<string>();
    for (const row of s.records[kind]) {
      for (const field of schema[kind].fields) {
        const v = row.values[field.key];
        // Derived names and membership email are intentionally not required.
        if (!field.optional) assert(typeof v === "string" && v.trim());
        if (!v) continue;
        if (field.options) assert(field.options.includes(v) || (kind === "memberships" && field.key === "role" && v === "SCHOOL_ADMIN"));
        if (field.type === "number") assert(Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100000 && (field.key === "points" || Number.isInteger(Number(v))));
        if (field.type === "date") assert(isoDate(v));
        if (field.ref) { const target = indexes[field.ref].get(v); assert(target && (field.ref === "users" || target.schoolId === row.schoolId)); }
      }
      for (const keys of schema[kind].unique ?? []) {
        const key = `${row.schoolId}:${keys.join(",")}:${keys.map(k => k === "name" ? row.name : k === "schoolId" ? row.schoolId : row.values[k]).join("|").toLowerCase()}`;
        assert(!unique.has(key)); unique.add(key);
      }
    }
  }
  const memberRoles = new Map<string, Set<string>>();
  for (const m of s.records.memberships) { assert(indexes.users.has(m.values.userId) && ["SCHOOL_ADMIN", "TEACHER", "STUDENT", "PARENT"].includes(m.values.role)); const key = `${m.schoolId}:${m.values.userId}`; const set = memberRoles.get(key) ?? new Set<string>(); set.add(m.values.role); memberRoles.set(key, set); }
  const role = (school: string, person: string, wanted: string) => memberRoles.get(`${school}:${person}`)?.has(wanted);
  for (const a of s.records.assignments) assert(role(a.schoolId, a.values.teacherId, "TEACHER"));
  const studentYears = new Set<string>();
  for (const e of s.records.enrollments) {
    assert(role(e.schoolId, e.values.studentId, "STUDENT"));
    const year = indexes.sections.get(e.values.sectionId)!.values.yearId;
    const key = `${e.schoolId}:${e.values.studentId}:${year}`;
    if (e.active) { assert(!studentYears.has(key)); studentYears.add(key); }
  }
  for (const l of s.records.links) assert(role(l.schoolId, l.values.parentId, "PARENT") && role(l.schoolId, l.values.studentId, "STUDENT") && ["pending", "approved", "revoked"].includes(l.values.status));
  for (const semester of s.records.semesters) { const year = indexes.years.get(semester.values.yearId)!; assert(Date.parse(semester.values.startDate) < Date.parse(semester.values.endDate) && Date.parse(semester.values.startDate) >= Date.parse(year.values.startDate) && Date.parse(semester.values.endDate) <= Date.parse(year.values.endDate)); }
  for (const year of s.records.years) assert(Date.parse(year.values.startDate) < Date.parse(year.values.endDate));
  for (const q of s.records.questions) {
    const choices = (q.values.choices ?? "").split("\n").map(v => v.trim()).filter(Boolean);
    assert(Number(q.values.points) > 0 && q.values.correct?.trim());
    if (q.values.type === "mcq") assert(choices.length >= 2 && new Set(choices).size === choices.length && choices.includes(q.values.correct));
    if (q.values.type === "boolean") assert(["true", "false"].includes(q.values.correct));
  }
  for (const bank of s.records.banks) assert(indexes.users.has(bank.values.ownerId) && role(bank.schoolId, bank.values.ownerId, "TEACHER"));
  for (const resource of s.records.resources) {
    if (resource.values.type === "link") { try { const url = new URL(resource.values.url); assert(url.protocol === "https:" && !url.username && !url.password); } catch { throw new DemoError("invalidSnapshot"); } }
    else assert(resource.values.filename?.trim() && Number(resource.values.size) >= 0);
  }
  for (const a of s.records.assessments) assert(Date.parse(a.values.opensAt) < Date.parse(a.values.dueAt) && ["draft", "published", "closed"].includes(a.values.status));
  for (const aq of s.records.assessmentQuestions) {
    const a = indexes.assessments.get(aq.values.assessmentId)!;
    const q = indexes.questions.get(aq.values.questionId)!;
    assert(indexes.banks.get(q.values.bankId)!.values.assignmentId === a.values.assignmentId);
  }
  for (const sub of s.records.submissions) {
    const a = indexes.assessments.get(sub.values.assessmentId)!;
    const assignment = indexes.assignments.get(a.values.assignmentId)!;
    assert(s.records.enrollments.some(e => e.schoolId === sub.schoolId && e.values.studentId === sub.values.studentId && e.values.sectionId === assignment.values.sectionId));
    assert(["ungraded", "grading", "graded", "released"].includes(sub.values.status));
  }
  const submissionPairs = new Set<string>();
  for (const sub of s.records.submissions) { const key = `${sub.schoolId}:${sub.values.studentId}:${sub.values.assessmentId}`; assert(!submissionPairs.has(key)); submissionPairs.add(key); }
  const draftIds = new Set<string>(); const draftPairs = new Set<string>();
  for (const draft of s.answerDrafts) {
    assert(object(draft) && typeof draft.id === "string" && safeId(draft.id) && !draftIds.has(draft.id));
    assert(typeof draft.schoolId === "string" && typeof draft.studentId === "string" && typeof draft.assessmentId === "string" && role(draft.schoolId, draft.studentId, "STUDENT"));
    const assessment = indexes.assessments.get(draft.assessmentId); assert(assessment && assessment.schoolId === draft.schoolId);
    const assignment = indexes.assignments.get(assessment.values.assignmentId)!;
    assert(s.records.enrollments.some(e => e.schoolId === draft.schoolId && e.values.studentId === draft.studentId && e.values.sectionId === assignment.values.sectionId));
    assert(Number.isInteger(draft.revision) && draft.revision > 0 && typeof draft.updatedAt === "string" && isoDate(draft.updatedAt));
    assert(object(draft.responses) && Object.values(draft.responses).every(v => typeof v === "string"));
    const key = `${draft.schoolId}:${draft.studentId}:${draft.assessmentId}`; assert(!draftPairs.has(key) && !submissionPairs.has(key));
    const qs = s.records.assessmentQuestions.filter(a => a.active && a.values.assessmentId === draft.assessmentId).map(a => indexes.questions.get(a.values.questionId)!);
    try { validateResponses(qs.map(q => ({ id: q.id, name: q.name, nameAr: q.nameAr, type: q.values.type as "mcq" | "boolean" | "short", choices: (q.values.choices ?? "").split("\n").map(v => v.trim()).filter(Boolean), points: Number(q.values.points) })), draft.responses, false); } catch { throw new DemoError("invalidSnapshot"); }
    draftIds.add(draft.id); draftPairs.add(key);
  }
  const questionFor = (subId: string, qId: string) => { const sub = indexes.submissions.get(subId)!; return s.records.assessmentQuestions.some(a => a.values.assessmentId === sub.values.assessmentId && a.values.questionId === qId); };
  const pairs = new Set<string>();
  for (const kind of ["answers", "scores"] as const) for (const row of s.records[kind]) {
    assert(questionFor(row.values.submissionId, row.values.questionId));
    const key = `${kind}:${row.values.submissionId}:${row.values.questionId}`; assert(!pairs.has(key)); pairs.add(key);
    if (kind === "scores") assert(Number(row.values.points) <= Number(indexes.questions.get(row.values.questionId)!.values.points) && role(row.schoolId, row.values.gradedBy, "TEACHER"));
  }
  for (const sub of s.records.submissions.filter(r => ["graded", "released"].includes(r.values.status))) {
    const qs = s.records.assessmentQuestions.filter(q => q.active && q.values.assessmentId === sub.values.assessmentId);
    assert(qs.length && qs.every(q => s.records.scores.some(g => g.values.submissionId === sub.id && g.values.questionId === q.values.questionId && (sub.values.status !== "released" || g.values.releasedAt))));
  }
  for (const a of s.records.announcements) assert(indexes.users.has(a.values.authorId) && (role(a.schoolId, a.values.authorId, "TEACHER") || role(a.schoolId, a.values.authorId, "SCHOOL_ADMIN")) && ["draft", "published"].includes(a.values.status));
  for (const n of s.records.notifications) { assert(indexes.users.has(n.values.recipientId) && memberRoles.has(`${n.schoolId}:${n.values.recipientId}`) && kinds.includes(n.values.targetKind as Kind)); const target = indexes[n.values.targetKind as Kind].get(n.values.targetId); assert(target && target.schoolId === n.schoolId); }
  const eventIds = new Set<string>();
  for (const e of s.events) { assert(object(e) && typeof e.id === "string" && !eventIds.has(e.id) && schools.has(e.schoolId) && memberRoles.has(`${e.schoolId}:${e.actorId}`) && kinds.includes(e.kind) && indexes[e.kind].get(e.recordId)?.schoolId === e.schoolId && typeof e.verb === "string" && Number.isFinite(Date.parse(e.at))); eventIds.add(e.id); }
  synchronizeCounts(s);
  return s;
}

export class DemoStore {
  private state?: Snapshot;
  private loading?: Promise<Snapshot>;
  private listeners = new Set<() => void>();
  private locked = false;
  persistent = true;
  migrated = false;
  constructor(private storage: StorageAdapter) {}
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  snapshot() { return this.state; }
  private emit() { this.listeners.forEach(l => l()); }
  private async persist(s: Snapshot) {
    this.state = s;
    try { await this.storage.set(STORAGE_KEY, encode(s)); this.persistent = true; }
    catch { this.persistent = false; }
    this.emit(); return { state: s, persistent: this.persistent };
  }
  load(): Promise<Snapshot> {
    if (this.state) return Promise.resolve(this.state);
    if (this.loading) return this.loading;
    this.loading = (async () => {
      let raw: string | null;
      try { raw = await this.storage.get(STORAGE_KEY); } catch { throw new DemoError("storageError"); }
      if (raw === null) { const s = freshSnapshot(); await this.persist(s); return s; }
      let s: Snapshot;
      try { s = decode(raw); } catch { throw new DemoError("corruptStorage"); }
      const oldVersion = (JSON.parse(raw) as { version: number }).version;
      if (oldVersion === 1 || oldVersion === 2) {
        // v2 can fill most of browser storage. Its additive v3 upgrade preserves
        // every record and uses an atomic adapter replacement even when a second
        // full copy will not fit. A failed replacement leaves the old document.
        try { await this.storage.set(`${STORAGE_KEY}.backup-v${oldVersion}`, raw); } catch { if (oldVersion === 1) throw new DemoError("storageError"); }
        this.migrated = true; await this.persist(s);
      } else { this.state = s; this.emit(); }
      return s;
    })().finally(() => { this.loading = undefined; });
    return this.loading;
  }
  private async mutate<T>(operation: (state: Snapshot) => { state: Snapshot } & T) {
    if (this.locked) throw new DemoError("working");
    this.locked = true;
    try { const current = await this.load(); const result = operation(clone(current)); return { ...result, ...await this.persist(result.state) }; }
    finally { this.locked = false; }
  }
  dispatch(session: Session, command: Command) {
    const learning = (c: Command): c is LearningCommand => ["saveAnswers", "submitAnswers", "readLearningNotification"].includes(c.type);
    return this.mutate<{ record?: DemoRecord; draft?: AnswerDraft }>(s => learning(command) ? executeLearning(s, session, command) : execute(s, session, command));
  }
  async importSnapshot(raw: string) {
    const validated = decode(raw); // Validate fully before touching the current document.
    if (this.locked) throw new DemoError("working");
    this.locked = true;
    try {
      const currentRaw = await this.storage.get(STORAGE_KEY);
      // Replacement is explicitly confirmed in the UI. Keep a backup when space
      // permits; a quota-limited backup must not make valid transfers impossible.
      if (currentRaw) { try { await this.storage.set(`${STORAGE_KEY}.before-import`, currentRaw); } catch { /* Users are prompted to export their current snapshot before replacing it. */ } }
      return await this.persist(validated);
    } finally { this.locked = false; }
  }
  exportSnapshot() { if (!this.state) throw new DemoError("corruptStorage"); return encode(this.state); }
  async reset() { return this.mutate(() => ({ state: freshSnapshot() })); }
  async saveAdministrator(administrator: Snapshot["administrator"]) {
    return this.mutate(s => { if ([administrator.name, administrator.nameAr, administrator.email].some(v => !v.trim()) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(administrator.email)) throw new DemoError("invalidEmail"); s.administrator = administrator; return { state: s }; });
  }
  async saveSchool(input: SchoolInput, schoolId?: string) {
    return this.mutate(s => {
      if ([input.name, input.nameAr, input.city, input.cityAr, input.administrator, input.administratorAr, input.email].some(v => !v.trim()) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw new DemoError("required");
      const old = schoolId ? s.schools.find(r => r.id === schoolId) : undefined;
      if (schoolId && !old) throw new DemoError("unavailable");
      const school = { id: schoolId ?? uid(), name: input.name.trim(), nameAr: input.nameAr.trim(), locale: input.locale, active: input.active, createdAt: old?.createdAt ?? new Date().toISOString(), demo: { city: input.city.trim(), cityAr: input.cityAr.trim(), administrator: input.administrator.trim(), administratorAr: input.administratorAr.trim(), email: input.email.trim(), students: old?.demo.students ?? 0, teachers: old?.demo.teachers ?? 0 } };
      if (old) {
        const member = s.records.memberships.find(m => m.schoolId === old.id && m.values.role === "SCHOOL_ADMIN" && get(s, "users", m.values.userId)?.values.email === old.demo.email);
        const user = member && get(s, "users", member.values.userId);
        if (user) {
          if (s.records.users.some(u => u.id !== user.id && u.values.email.toLowerCase() === school.demo.email.toLowerCase())) throw new DemoError("duplicate");
          user.name = school.demo.administrator; user.nameAr = school.demo.administratorAr; user.values.email = school.demo.email;
        }
        s.schools = s.schools.map(r => r.id === school.id ? school : r);
      } else { s.schools.unshift(school); addSchoolAdministrator(s, school.id); }
      s.activity.unshift({ id: uid(), schoolId: school.id, action: (old ? "edited" : "created") as Action, actor: s.administrator.name, actorAr: s.administrator.nameAr, at: new Date().toISOString() });
      return { state: s, school };
    });
  }
  setActive(schoolId: string, active: boolean) {
    return this.mutate(s => { const school = s.schools.find(r => r.id === schoolId); if (!school) throw new DemoError("unavailable"); if (school.active !== active) { school.active = active; s.activity.unshift({ id: uid(), schoolId, action: active ? "reactivated" : "suspended", actor: s.administrator.name, actorAr: s.administrator.nameAr, at: new Date().toISOString() }); } return { state: s }; });
  }
}
