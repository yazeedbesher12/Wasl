import { seedLegacy } from "./legacy";
import { kinds } from "./model";
import type { DemoRecord, Kind, LegacyState, Snapshot, Tables } from "./model";

export function emptyTables(): Tables { return Object.fromEntries(kinds.map(k => [k, []])) as unknown as Tables; }
export function migrate(legacy: LegacyState): Snapshot {
  const state: Snapshot = { ...legacy, version: 3, records: emptyTables(), events: [], answerDrafts: [] };
  const aliases = new Map<string, string>();
  const add = (kind: Kind, id: string, schoolId: string, name: string, nameAr: string, values: Record<string, string> = {}): DemoRecord => {
    if (kind === "users") {
      const existing = state.records.users.find(u => u.values.email.toLowerCase() === values.email.toLowerCase());
      if (existing) { aliases.set(id, existing.id); return existing; }
    }
    const record = { id, schoolId, name, nameAr, active: true, values };
    state.records[kind].push(record); return record;
  };
  for (const school of state.schools) {
    const s = school.id;
    const admin = add("users", `${s}-admin`, "", school.demo.administrator, school.demo.administratorAr, { email: school.demo.email });
    add("memberships", `${s}-admin-member`, s, admin.name, admin.nameAr, { userId: admin.id, role: "SCHOOL_ADMIN" });
    // Preserve existing aggregate data by materializing fictional people with
    // stable memberships. Counts now come from these same records for every role.
    for (const role of ["TEACHER", "STUDENT"] as const) {
      const count = role === "TEACHER" ? school.demo.teachers : school.demo.students;
      for (let i = 1; i <= count; i++) {
        const key = `${s}-${role.toLowerCase()}-${i}`;
        const name = role === "TEACHER" ? i === 1 ? "Lina Ahmad" : `Teacher ${i}` : i === 1 ? "Adam Khalil" : i === 2 ? "Maya Saleh" : `Student ${i}`;
        const nameAr = role === "TEACHER" ? i === 1 ? "لينا أحمد" : `المعلم ${i}` : i === 1 ? "آدم خليل" : i === 2 ? "مايا صالح" : `الطالب ${i}`;
        add("users", key, "", name, nameAr, { email: `${key}@example.com` });
        add("memberships", `${key}-member`, s, name, nameAr, { userId: key, role });
      }
    }
    // Empty/new schools keep an empty academic workspace.
    if (!school.demo.students && !school.demo.teachers) continue;
    const year = add("years", `${s}-year`, s, "2026–2027", "٢٠٢٦–٢٠٢٧", { startDate: "2026-09-01", endDate: "2027-06-30" });
    add("preferences", `${s}-preferences`, s, "Current year", "العام الحالي", { currentYearId: year.id });
    add("semesters", `${s}-semester`, s, "First semester", "الفصل الأول", { yearId: year.id, startDate: "2026-09-01", endDate: "2027-01-15" });
    add("grades", `${s}-grade`, s, "Grade seven", "الصف السابع", { level: "7" });
    const section = add("sections", `${s}-section`, s, "7 A", "السابع أ", { yearId: year.id, gradeId: `${s}-grade` });
    add("subjects", `${s}-math`, s, "Mathematics", "الرياضيات", { code: "MATH7" });
    if (school.demo.teachers) add("assignments", `${s}-class`, s, "7 A · Mathematics", "السابع أ · الرياضيات", { sectionId: section.id, subjectId: `${s}-math`, teacherId: `${s}-teacher-1` });
    for (let i = 1; i <= Math.min(24, school.demo.students); i++) add("enrollments", `${s}-enrollment-${i}`, s, `Student ${i} · 7 A`, `الطالب ${i} · السابع أ`, { sectionId: section.id, studentId: `${s}-student-${i}` });
    if (!school.demo.students) continue;
    add("users", `${s}-parent`, "", "Rana Khalil", "رنا خليل", { email: `${s}-parent@example.com` });
    add("memberships", `${s}-parent-member`, s, "Rana Khalil", "رنا خليل", { userId: `${s}-parent`, role: "PARENT" });
    add("links", `${s}-link`, s, "Rana · Adam", "رنا · آدم", { parentId: `${s}-parent`, studentId: `${s}-student-1`, status: "approved" });
    if (!school.demo.teachers) continue;
    add("units", `${s}-unit`, s, "Fractions", "الكسور", { assignmentId: `${s}-class`, order: "1" });
    add("lessons", `${s}-lesson`, s, "Equivalent fractions", "الكسور المتكافئة", { unitId: `${s}-unit`, body: "1/2 = 2/4. Multiply the numerator and denominator by the same number.\n١/٢ = ٢/٤. نضرب البسط والمقام في العدد نفسه.", order: "1", status: "published" });
    add("resources", `${s}-resource`, s, "Fraction worksheet (demo)", "ورقة الكسور (تجريبية)", { lessonId: `${s}-lesson`, type: "file", filename: "fractions-demo.pdf", size: "48" });
    add("banks", `${s}-bank`, s, "Fraction practice", "تدريبات الكسور", { assignmentId: `${s}-class`, ownerId: `${s}-teacher-1` });
    add("questions", `${s}-q1`, s, "Which equals one half?", "أي كسر يساوي النصف؟", { bankId: `${s}-bank`, type: "mcq", choices: "2/4\n1/3\n3/4", correct: "2/4", points: "4" });
    add("questions", `${s}-q2`, s, "Equivalent fractions represent the same value.", "الكسور المتكافئة تمثل القيمة نفسها.", { bankId: `${s}-bank`, type: "boolean", correct: "true", points: "2" });
    add("questions", `${s}-q3`, s, "Explain why 2/4 equals 1/2.", "فسّر لماذا ٢/٤ يساوي ١/٢.", { bankId: `${s}-bank`, type: "short", correct: "Divide numerator and denominator by two.", points: "4" });
    add("assessments", `${s}-assessment`, s, "Fraction check", "تقييم الكسور", { assignmentId: `${s}-class`, type: "assignment", instructions: "Answer all questions. أجب عن جميع الأسئلة.", opensAt: "2026-10-01T08:00:00Z", dueAt: "2026-10-20T15:00:00Z", status: "closed" });
    add("assessments", `${s}-draft`, s, "Fractions · next practice", "الكسور · التدريب القادم", { assignmentId: `${s}-class`, type: "exam", instructions: "Show your working. وضّح خطوات الحل.", opensAt: "2027-01-20T08:00:00Z", dueAt: "2027-01-20T15:00:00Z", status: "draft" });
    for (let q = 1; q <= 3; q++) add("assessmentQuestions", `${s}-aq-${q}`, s, `Question ${q}`, `السؤال ${q}`, { assessmentId: `${s}-assessment`, questionId: `${s}-q${q}`, order: `${q}` });
    for (let i = 1; i <= Math.min(3, school.demo.students); i++) {
      const sub = add("submissions", `${s}-submission-${i}`, s, `Fraction check · Student ${i}`, `تقييم الكسور · الطالب ${i}`, { assessmentId: `${s}-assessment`, studentId: `${s}-student-${i}`, submittedAt: `2026-10-19T1${i}:00:00Z`, status: "ungraded" });
      for (let q = 1; q <= 3; q++) add("answers", `${s}-answer-${i}-${q}`, s, `Answer ${q}`, `الإجابة ${q}`, { submissionId: sub.id, questionId: `${s}-q${q}`, response: q === 1 ? i === 2 ? "1/3" : "2/4" : q === 2 ? "true" : "Both parts can be divided by 2. يمكن قسمة الطرفين على ٢.", ...(q === 3 ? { filename: "working-demo.jpg" } : {}) });
    }
    add("announcements", `${s}-announcement`, s, "Welcome to the term", "مرحباً بكم في الفصل الدراسي", { audience: "all", body: "Review your class assignments and prepare the first unit.\nراجع تكليفات الصفوف وجهّز الوحدة الأولى.", authorId: admin.id, status: "published" });
    add("notifications", `${s}-notification`, s, "Welcome to the term", "مرحباً بكم في الفصل الدراسي", { recipientId: `${s}-teacher-1`, targetKind: "announcements", targetId: `${s}-announcement`, readAt: "", body: "A school announcement is available. يوجد إعلان مدرسي جديد.", at: "2026-09-01T08:00:00Z" });
  }
  for (const kind of kinds) for (const row of state.records[kind]) for (const key of ["userId", "teacherId", "studentId", "parentId", "ownerId", "authorId", "recipientId"]) {
    const canonical = aliases.get(row.values[key]); if (canonical) row.values[key] = canonical;
  }
  return state;
}
export const freshSnapshot = () => {
  const s = migrate(seedLegacy());
  for (const a of s.records.assignments) {
    const id = `${a.schoolId}-open-practice`;
    s.records.assessments.push({ id, schoolId: a.schoolId, name: "Independent fraction practice", nameAr: "تدريب الكسور المستقل", active: true, values: { assignmentId: a.id, type: "assignment", instructions: "Answer each question, save a draft, then submit when ready.\nأجب عن كل سؤال، واحفظ مسودة، ثم سلّم عند الانتهاء.", status: "published", opensAt: "2026-09-01T08:00:00Z", dueAt: "2027-06-25T15:00:00Z", publishedAt: "2026-11-01T08:00:00Z" } });
    for (let q = 1; q <= 3; q++) s.records.assessmentQuestions.push({ id: `${id}-question-${q}`, schoolId: a.schoolId, name: `Question ${q}`, nameAr: `السؤال ${q}`, active: true, values: { assessmentId: id, questionId: `${a.schoolId}-q${q}`, order: `${q}` } });
  }
  // A family across two schools for fresh demos only. Existing snapshots are
  // upgraded without inventing or changing any saved parent-child approvals.
  const parent = s.records.users.find(u => u.id === "school-1-parent");
  const child = s.records.users.find(u => u.id === "school-2-student-2");
  if (parent && child) {
    s.records.memberships.push({ id: "family-parent-school-2", schoolId: "school-2", name: parent.name, nameAr: parent.nameAr, active: true, values: { userId: parent.id, role: "PARENT" } });
    s.records.links.push({ id: "family-child-school-2", schoolId: "school-2", name: "Rana · Maya", nameAr: "رنا · مايا", active: true, values: { parentId: parent.id, studentId: child.id, status: "approved" } });
  }
  return s;
};
