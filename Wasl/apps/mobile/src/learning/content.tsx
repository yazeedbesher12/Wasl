import { useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { date, label, learningAnnouncements, learningChildren, learningClasses, learningContext, learningLessons, learningNotifications, learningProfile, learningResults, learningSummary, learningTasks, number } from "../../../../packages/shared/src/demo";
import type { ClassView, LessonView, ResourceView, Session, TaskView } from "../../../../packages/shared/src/demo";
import { useNative } from "../context";
import { artStyles, NativeEducationArt, NativeNavIcon, NativeSubjects, NativeWelcome } from "../education";
import { Badge, Button, Card, Field, Select, styles, Txt } from "../ui";

export function NativeLearningEmpty({ title = "learningEmpty", body = "learningEmptyHelp" }: { title?: string; body?: string }) {
  const { t } = useNative(); return <Card><NativeEducationArt subject="" width={88} /><Txt title>{t(title)}</Txt><Txt muted>{t(body)}</Txt></Card>;
}
export function NativeChildren({ welcome = false }: { welcome?: boolean }) {
  const { data, session, locale, t, go } = useNative(); if (!data) return null;
  const rows = learningChildren(data, session); if (!rows.length) return <NativeLearningEmpty title="noChildren" body="noChildrenHelp" />;
  return <View>{welcome && <NativeWelcome title={t("welcome")} name={label(locale, learningProfile(data, session).user)} intro={t("welcomeParent")} theme="parent"><Button onPress={() => go({ page: "profile" })}>{t("profile")}</Button></NativeWelcome>}{rows.map(child => {
    const summary = learningSummary(data, { ...session, childLinkId: child.linkId });
    return <Card key={child.linkId}><Txt title>{label(locale, child.student)}</Txt><Txt>{label(locale, child.school)}</Txt>{child.enrollments.map((e, i) => <Txt key={i} muted>{label(locale, e.grade)} · {label(locale, e.section)} · {label(locale, e.year)}</Txt>)}{!child.enrollments.length && <Txt muted>{t("noEnrollment")}</Txt>}<Txt muted>{t("pendingTasks")}: {number(locale, summary.pending)} · {t("releasedResults")}: {number(locale, summary.released)}</Txt><Button onPress={() => go({ page: "dashboard", childLinkId: child.linkId })}>{t("view")}</Button></Card>;
  })}</View>;
}
export function NativeLearningContext({ scoped }: { scoped: Session }) {
  const { data, t, locale } = useNative(); if (!data) return null; const c = learningContext(data, scoped);
  return <Card><Txt style={{ fontWeight: "700" }}>{label(locale, c.student)}</Txt><Txt muted>{label(locale, c.school)}</Txt>{c.currentYear && <Txt muted>{t("currentYear")}: {label(locale, c.currentYear)}</Txt>}{c.enrollments.map((e, i) => <Txt key={i} muted>{label(locale, e.grade)} · {label(locale, e.section)} · {label(locale, e.year)}</Txt>)}{!c.enrollments.length && <Txt muted>{t("noEnrollment")}</Txt>}</Card>;
}
export function NativeClassCards({ rows }: { rows: ClassView[] }) {
  const { t, locale, go } = useNative(); if (!rows.length) return <NativeLearningEmpty title="noEnrollment" body="noEnrollmentHelp" />;
  return <View>{rows.map(c => <Card key={c.id}><View style={artStyles.classArt}><NativeEducationArt subject={`${c.subject.name} ${c.subject.nameAr}`} width={132} /></View><Txt title>{label(locale, c.subject)}</Txt><Txt>{t("teacherId")}: {label(locale, c.teacher)}</Txt><Txt muted>{label(locale, c.section)} · {label(locale, c.year)}</Txt><Txt muted>{number(locale, c.lessonCount)} {t("lessons")} · {number(locale, c.taskCount)} {t("tasks")}</Txt><Button secondary onPress={() => go({ page: "classes", id: c.id })}>{t("view")}</Button></Card>)}</View>;
}
export function NativeResource({ resource }: { resource: ResourceView }) {
  const { t, locale, setError } = useNative();
  return <Card><Txt style={{ fontWeight: "700" }}>{label(locale, resource)}</Txt>{resource.type === "file" ? <><Txt ltr>{resource.filename} · {number(locale, resource.size ?? 0)} {t("fileSizeUnit")}</Txt><Txt muted>{t("attachmentNotice")}</Txt></> : <><Txt muted ltr>{resource.url}</Txt><Button secondary onPress={() => { if (resource.url) void Linking.openURL(resource.url).catch(() => setError({ code: "invalidUrl" })); }}>{t("view")}</Button></>}</Card>;
}
export function NativeLessonCards({ rows }: { rows: LessonView[] }) {
  const { t, locale, go } = useNative(); if (!rows.length) return <NativeLearningEmpty />;
  return <View>{rows.map(l => <Card key={l.id}><Txt muted>{label(locale, l.unit)}</Txt><Txt style={{ fontWeight: "700" }}>{label(locale, l)}</Txt><Txt muted numberOfLines={3}>{l.body}</Txt><Button secondary onPress={() => go({ page: "lessons", id: l.id })}>{t("view")}</Button></Card>)}</View>;
}
export function NativeTaskCards({ rows }: { rows: TaskView[] }) {
  const { t, locale, go } = useNative(); if (!rows.length) return <NativeLearningEmpty />;
  return <View>{rows.map(task => <Card key={task.id}><Txt style={{ fontWeight: "700" }}>{label(locale, task)}</Txt><Badge value={task.status} /><Txt muted>{t(task.type)} · {t("deadlineLabel")}: {date(locale, task.dueAt)}</Txt>{task.receipt && <Txt muted>{t(task.receipt.stage)}</Txt>}<Button secondary onPress={() => go({ page: "tasks", id: task.id })}>{t("view")}</Button></Card>)}</View>;
}
export function NativeLearningDashboard({ scoped, now }: { scoped: Session; now: number }) {
  const { data, t, locale, go } = useNative(); if (!data) return null;
  const summary = learningSummary(data, scoped, now); const classes = learningClasses(data, scoped); const lessons = [...learningLessons(data, scoped)].sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")).slice(0, 4); const results = learningResults(data, scoped);
  const identity = learningContext(data, scoped); const parent = identity.role === "parent";
  return <View><NativeWelcome title={t("welcome")} name={label(locale, identity.user)} intro={t(parent ? "welcomeParent" : "welcomeStudent")} theme={parent ? "parent" : "student"}><Button onPress={() => go({ page: "tasks" })}>{t("tasks")}</Button><Button secondary onPress={() => go({ page: "classes" })}>{t("classes")}</Button></NativeWelcome><NativeSubjects title={t("exploreClasses")} intro={t("subjectStripHelp")} rows={classes.map(c => ({ id: c.id, name: label(locale, c.subject), subject: `${c.subject.name} ${c.subject.nameAr}`, detail: label(locale, c.section) }))} open={id => go({ page: "classes", id })} /><View style={styles.metricGrid}>{[{ label: "classes", value: classes.length, page: "classes" }, { label: "pendingTasks", value: summary.pending, page: "tasks" }, { label: "submitted", value: summary.submitted, page: "tasks" }, { label: "releasedResults", value: summary.released, page: "results" }].map(m => <Pressable key={m.label} accessibilityRole="button" style={styles.metric} onPress={() => go({ page: m.page })}><View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: "#315DE5", justifyContent: "center" }}><NativeNavIcon page={m.page} selected /></View><Txt muted>{t(m.label)}</Txt><Txt title>{number(locale, m.value)}</Txt></Pressable>)}</View>{!classes.length && <NativeLearningEmpty title="noEnrollment" body="noEnrollmentHelp" />}<Txt style={styles.sectionTitle}>{t("upcomingDeadlines")}</Txt><NativeTaskCards rows={summary.upcoming.slice(0, 5)} /><Txt style={styles.sectionTitle}>{t("recentLessons")}</Txt><NativeLessonCards rows={lessons} /><Txt style={styles.sectionTitle}>{t("releasedResults")}</Txt>{results.length ? results.slice(0, 3).map(r => <Card key={r.id}><Txt>{label(locale, r)}</Txt><Txt>{number(locale, r.earned)} / {number(locale, r.maximum)}</Txt><Button secondary onPress={() => go({ page: "results", id: r.id })}>{t("view")}</Button></Card>) : <NativeLearningEmpty title="noReleased" body="privateGrading" />}<NativeLearningAnnouncements scoped={scoped} compact /></View>;
}
export function NativeLearningTasks({ scoped, now }: { scoped: Session; now: number }) {
  const { data, session, t, locale, ui, setUI } = useNative(); const [page, setPage] = useState(1);
  const key = `learning:${session.membershipId}:${scoped.childLinkId ?? "self"}:tasks`;
  const [query, classId, status, type] = ui.filters[key] ?? ["", "", "", ""]; if (!data) return null;
  const set = (idx: number, value: string) => { setPage(1); setUI(old => { const filters = [...(old.filters[key] ?? ["", "", "", ""])]; filters[idx] = value; return { ...old, filters: { ...old.filters, [key]: filters } }; }); };
  const all = learningTasks(data, scoped, now); const rows = all.filter(t => (!classId || t.classId === classId) && (!status || t.status === status) && (!type || t.type === type) && `${t.name} ${t.nameAr}`.toLowerCase().includes(query.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(rows.length / 8)); const current = Math.min(page, pages);
  return <View><Card><Field label={t("search")} value={query} onChangeText={v => set(0, v)} /><Select label={t("subjectId")} optional value={classId} options={learningClasses(data, scoped).map(c => ({ value: c.id, label: label(locale, c.subject) }))} onChange={v => set(1, v)} /><Select label={t("status")} optional value={status} options={["upcoming", "submitted", "late", "missing", "resultAvailable"].map(v => ({ value: v, label: t(v) }))} onChange={v => set(2, v)} /><Select label={t("type")} optional value={type} options={["assignment", "exam"].map(v => ({ value: v, label: t(v) }))} onChange={v => set(3, v)} /><Button secondary onPress={() => setUI(old => ({ ...old, filters: { ...old.filters, [key]: ["", "", "", ""] } }))}>{t("resetFilters")}</Button><Txt muted>{number(locale, rows.length)} {t("results")}</Txt></Card>{rows.length || !all.length ? <NativeTaskCards rows={rows.slice((current - 1) * 8, current * 8)} /> : <NativeLearningEmpty title="noMatches" body="filterHelp" />}<View style={styles.row}><Button secondary disabled={current === 1} onPress={() => setPage(current - 1)}>{t("previous")}</Button><Txt>{number(locale, current)} {t("of")} {number(locale, pages)}</Txt><Button secondary disabled={current >= pages} onPress={() => setPage(current + 1)}>{t("next")}</Button></View></View>;
}
export function NativeLearningLessons({ scoped }: { scoped: Session }) {
  const { data, session, t, locale, ui, setUI } = useNative(); const key = `learning:${session.membershipId}:${scoped.childLinkId ?? "self"}:lessons`;
  const [query, classId] = ui.filters[key] ?? ["", ""]; if (!data) return null;
  const set = (idx: number, value: string) => setUI(old => { const f = [...(old.filters[key] ?? ["", ""])]; f[idx] = value; return { ...old, filters: { ...old.filters, [key]: f } }; });
  const all = learningLessons(data, scoped); const rows = all.filter(l => (!classId || l.classId === classId) && `${l.name} ${l.nameAr} ${l.body}`.toLowerCase().includes(query.trim().toLowerCase()));
  const units = [...new Map(rows.map(l => [l.unit.id, l.unit] as const)).values()];
  return <View><Card><Field label={t("search")} value={query} onChangeText={v => set(0, v)} /><Select label={t("subjectId")} value={classId} optional options={learningClasses(data, scoped).map(c => ({ value: c.id, label: label(locale, c.subject) }))} onChange={v => set(1, v)} /></Card>{!rows.length && <NativeLearningEmpty title={all.length ? "noMatches" : "learningEmpty"} body={all.length ? "filterHelp" : "learningEmptyHelp"} />}{units.map(u => <View key={u.id}><Txt style={styles.sectionTitle}>{label(locale, u)}</Txt><NativeLessonCards rows={rows.filter(l => l.unit.id === u.id)} /></View>)}</View>;
}
export function NativeTaskDetail({ task, parent }: { task: TaskView; parent: boolean }) {
  const { t, locale, go } = useNative();
  return <Card><Txt title>{label(locale, task)}</Txt><Badge value={task.status} /><Txt muted>{t(task.type)}</Txt><Txt>{task.instructions}</Txt><Txt muted>{t("opensLabel")}: {date(locale, task.opensAt)}</Txt><Txt muted>{t("deadlineLabel")}: {date(locale, task.dueAt)}</Txt><Txt>{t("questions")}: {number(locale, task.questionCount)} · {t("marks")}: {number(locale, task.maxMarks)}</Txt><Txt muted>{t(task.window)}</Txt><Txt muted>{t(parent ? "parentReadOnly" : "attemptRules")}</Txt>{task.draft && <Txt muted>{t("answerDraft")} · {date(locale, task.draft.updatedAt)}</Txt>}{task.canAttempt && !parent && <Button onPress={() => go({ page: "tasks", id: task.id, attempt: true })}>{t(task.draft ? "resumeAttempt" : "startAttempt")}</Button>}{task.receipt && <><Badge value={task.receipt.stage} /><Button secondary onPress={() => go({ page: "submissions", id: task.receipt!.id })}>{t("receipt")}</Button></>}</Card>;
}
export function NativeLearningResults({ scoped, id }: { scoped: Session; id?: string }) {
  const { data, t, locale, go, ui, setUI, session } = useNative(); if (!data) return null;
  const key = `learning:${session.membershipId}:${scoped.childLinkId ?? "self"}:results`; const classId = ui.filters[key]?.[0] ?? "";
  const rows = learningResults(data, scoped); const result = id ? rows.find(r => r.id === id) : undefined;
  if (id && !result) return <NativeLearningEmpty title="unavailableRecord" body="privateGrading" />;
  if (result) return <View><Card><Txt title>{label(locale, result)}</Txt><Txt title>{number(locale, result.earned)} / {number(locale, result.maximum)}</Txt><Txt muted>{t("releasedAt")}: {date(locale, result.releasedAt)}</Txt><Txt muted>{t("releasedMarks")}</Txt></Card>{result.breakdown.map(g => <Card key={g.question.id}><Txt style={{ fontWeight: "700" }}>{label(locale, g.question)}</Txt><Txt>{t("response")}: {t(g.response)}</Txt><Txt>{number(locale, g.score)} / {number(locale, g.question.points)}</Txt>{!!g.feedback && <Txt>{t("feedback")}: {g.feedback}</Txt>}</Card>)}</View>;
  const shown = rows.filter(r => !classId || r.classId === classId); const pending = learningTasks(data, scoped).filter(t => t.receipt && t.receipt.stage !== "released" && (!classId || t.classId === classId));
  return <View><Card><Txt muted>{t("privateGrading")}</Txt><Select label={t("subjectId")} value={classId} optional options={learningClasses(data, scoped).map(c => ({ value: c.id, label: label(locale, c.subject) }))} onChange={v => setUI(old => ({ ...old, filters: { ...old.filters, [key]: [v] } }))} /></Card>{!shown.length && <NativeLearningEmpty title="noReleased" body="privateGrading" />}{shown.map(r => <Card key={r.id}><Txt title>{label(locale, r)}</Txt><Txt>{number(locale, r.earned)} / {number(locale, r.maximum)}</Txt><Txt muted>{date(locale, r.releasedAt)}</Txt><Button secondary onPress={() => go({ page: "results", id: r.id })}>{t("view")}</Button></Card>)}{!!pending.length && <><Txt style={styles.sectionTitle}>{t("awaitingRelease")}</Txt><NativeTaskCards rows={pending} /></>}</View>;
}
export function NativeLearningAnnouncements({ scoped, id, compact = false }: { scoped: Session; id?: string; compact?: boolean }) {
  const { data, t, locale, go } = useNative(); if (!data) return null;
  let rows = learningAnnouncements(data, scoped); if (id) rows = rows.filter(a => a.id === id); if (compact) rows = rows.slice(0, 3);
  return <View><Txt style={styles.sectionTitle}>{t("announcements")}</Txt>{!rows.length && <NativeLearningEmpty />}{rows.map(a => <Card key={a.id} accent><Txt style={{ fontWeight: "700" }}>{label(locale, a)}</Txt><Txt>{a.body}</Txt>{!id && <Button secondary onPress={() => go({ page: "announcements", id: a.id })}>{t("view")}</Button>}</Card>)}</View>;
}
export function NativeLearningNotifications({ scoped, id }: { scoped: Session; id?: string }) {
  const n = useNative(); const { data, t, locale, go, busy, ui, setUI } = n; if (!data) return null;
  const key = `learning:${scoped.membershipId}:${scoped.childLinkId ?? "self"}:notifications`; const status = ui.filters[key]?.[0] ?? "";
  const rows = learningNotifications(data, scoped).filter(v => (!id || v.id === id) && (!status || v.read === (status === "read")));
  return <View>{!id && <Card><Select label={t("status")} value={status} optional options={["read", "unread"].map(v => ({ value: v, label: t(v) }))} onChange={v => setUI(old => ({ ...old, filters: { ...old.filters, [key]: [v] } }))} /></Card>}{!rows.length && <NativeLearningEmpty />}{rows.map(v => <Card key={`${v.id}:${v.destination?.childLinkId ?? ""}`}><Txt style={{ fontWeight: "700" }}>{v.available ? label(locale, v) : t("unavailableRecord")}</Txt><Badge value={v.read ? "read" : "unread"} /><Txt muted>{v.child && `${label(locale, v.child)} · `}{label(locale, v.school)} · {date(locale, v.at)}</Txt>{id && !!v.body && <Txt>{v.body}</Txt>}<Button secondary disabled={busy} onPress={() => void n.runLearning({ type: "readLearningNotification", id: v.id, read: !v.read }, scoped.childLinkId)}>{t(v.read ? "markUnread" : "markRead")}</Button>{v.destination && <Button secondary onPress={() => go({ page: v.destination!.page, id: v.destination!.id, childLinkId: v.destination!.childLinkId ?? scoped.childLinkId })}>{t("destination")}</Button>}{!id && <Button secondary onPress={() => go({ page: "notifications", id: v.id, childLinkId: scoped.childLinkId })}>{t("view")}</Button>}</Card>)}</View>;
}
export function NativeLearningProfile() {
  const { data, session, t, locale, setLocale } = useNative(); if (!data) return null; const p = learningProfile(data, session);
  return <View><Card><Txt title>{label(locale, p.user)}</Txt><Txt ltr>{p.user.email}</Txt><Txt muted>{t("profileHelp")}</Txt>{p.school && <Txt>{label(locale, p.school)}</Txt>}{p.enrollments.map((e, i) => <Txt key={i} muted>{label(locale, e.grade)} · {label(locale, e.section)} · {label(locale, e.year)}</Txt>)}<View style={styles.row}><Button secondary onPress={() => void setLocale("ar")}>عربي</Button><Button secondary onPress={() => void setLocale("en")}>English</Button></View></Card>{p.role === "parent" && <NativeChildren />}</View>;
}
