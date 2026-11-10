"use client";
import Link from "next/link";
import { useState } from "react";
import type { ReactNode } from "react";
import { date, label, learningAnnouncements, learningChildren, learningClasses, learningContext, learningLessons, learningNotifications, learningPath, learningProfile, learningResults, learningSummary, learningTasks, number } from "@wasl/shared/demo";
import type { ClassView, LearningRole, LessonView, ResourceView, Session, TaskView } from "@wasl/shared/demo";
import { useWorkspace } from "../provider";
import { Badge, Language, Pager } from "../ui";
import { EducationArt, NavigationIcon, SubjectStrip, Welcome } from "../../education";

export function LearningEmpty({ title = "learningEmpty", body = "learningEmptyHelp" }: { title?: string; body?: string }) {
  const { t } = useWorkspace(); return <div className="empty"><EducationArt subject="" className="empty-illustration" /><h2>{t(title)}</h2><p className="muted">{t(body)}</p></div>;
}
export function LearningPanel({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useWorkspace(); return <section className="panel learning-panel"><h2>{t(title)}</h2>{children}</section>;
}
export function ChildrenOverview({ welcome = false }: { welcome?: boolean }) {
  const { data, session, locale, t } = useWorkspace(); if (!data) return null;
  const children = learningChildren(data, session);
  if (!children.length) return <LearningEmpty title="noChildren" body="noChildrenHelp" />;
  return <>{welcome && <Welcome title={t("welcome")} name={label(locale, learningProfile(data, session).user)} intro={t("welcomeParent")} theme="parent"><Link className="button" href="/parent/profile">{t("profile")}</Link></Welcome>}<div className="learning-cards">{children.map(child => {
    const summary = learningSummary(data, { ...session, childLinkId: child.linkId });
    return <article className="panel learning-card" key={child.linkId}><h2>{label(locale, child.student)}</h2><p>{label(locale, child.school)}</p>{child.enrollments.map((e, i) => <p className="muted" key={i}>{label(locale, e.grade)} · {label(locale, e.section)} · {label(locale, e.year)}</p>)}{!child.enrollments.length && <p className="muted">{t("noEnrollment")}</p>}<p className="muted">{t("pendingTasks")}: {number(locale, summary.pending)} · {t("releasedResults")}: {number(locale, summary.released)}</p><Link className="button" href={learningPath("parent", child.linkId, "dashboard")}>{t("view")}</Link></article>;
  })}</div></>;
}
export function LearningContextBar({ scoped }: { scoped: Session }) {
  const { data, locale, t } = useWorkspace(); if (!data) return null;
  const c = learningContext(data, scoped);
  return <section className="learning-context"><div><strong>{label(locale, c.student)}</strong><p className="muted">{label(locale, c.school)}</p>{c.currentYear && <p className="muted">{t("currentYear")}: {label(locale, c.currentYear)}</p>}</div><div>{c.enrollments.map((e, i) => <p key={i}>{label(locale, e.grade)} · {label(locale, e.section)} · {label(locale, e.year)}</p>)}{!c.enrollments.length && <p>{t("noEnrollment")}</p>}</div></section>;
}
export function ClassCards({ rows, role, scoped }: { rows: ClassView[]; role: LearningRole; scoped: Session }) {
  const { locale, t } = useWorkspace();
  if (!rows.length) return <LearningEmpty title="noEnrollment" body="noEnrollmentHelp" />;
  return <div className="learning-cards">{rows.map(c => <article className="panel learning-card subject-class-card" key={c.id}><div className="class-illustration"><EducationArt subject={`${c.subject.name} ${c.subject.nameAr}`} /></div><h2>{label(locale, c.subject)}</h2><p>{t("teacherId")}: {label(locale, c.teacher)}</p><p className="muted">{label(locale, c.grade)} · {label(locale, c.section)} · {label(locale, c.year)}</p><p className="muted">{number(locale, c.lessonCount)} {t("lessons")} · {number(locale, c.taskCount)} {t("tasks")}</p><Link className="button secondary" href={learningPath(role, scoped.childLinkId, "classes", c.id)}>{t("view")}</Link></article>)}</div>;
}
export function ResourceContent({ resource }: { resource: ResourceView }) {
  const { locale, t } = useWorkspace();
  return <article className="resource-row"><div><h3>{label(locale, resource)}</h3>{resource.type === "file" ? <><p dir="ltr">{resource.filename} · {number(locale, resource.size ?? 0)} {t("fileSizeUnit")}</p><p className="muted">{t("attachmentNotice")}</p></> : <p className="muted" dir="ltr">{resource.url}</p>}</div>{resource.type === "link" && <a className="button secondary" href={resource.url} target="_blank" rel="noreferrer">{t("view")}</a>}</article>;
}
export function LessonCards({ rows, role, scoped }: { rows: LessonView[]; role: LearningRole; scoped: Session }) {
  const { locale, t } = useWorkspace(); if (!rows.length) return <LearningEmpty />;
  return <div className="learning-list">{rows.map(l => <article className="learning-row" key={l.id}><div><small className="muted">{label(locale, l.unit)}</small><h3>{label(locale, l)}</h3><p className="muted learning-excerpt">{l.body}</p></div><Link className="button secondary" href={learningPath(role, scoped.childLinkId, "lessons", l.id)}>{t("view")}</Link></article>)}</div>;
}
export function TaskCards({ rows, role, scoped }: { rows: TaskView[]; role: LearningRole; scoped: Session }) {
  const { locale, t } = useWorkspace(); if (!rows.length) return <LearningEmpty />;
  return <div className="learning-list">{rows.map(task => <article key={task.id} className="learning-row"><div><div className="actions"><h3>{label(locale, task)}</h3><Badge value={task.status} /></div><p className="muted">{t(task.type)} · {t("deadlineLabel")}: {date(locale, task.dueAt)}</p>{task.receipt && <p className="muted">{t(task.receipt.stage)}</p>}</div><Link className="button secondary" href={learningPath(role, scoped.childLinkId, "tasks", task.id)}>{t("view")}</Link></article>)}</div>;
}
export function LearningDashboard({ role, scoped, now }: { role: LearningRole; scoped: Session; now: number }) {
  const { data, locale, t } = useWorkspace(); if (!data) return null;
  const summary = learningSummary(data, scoped, now); const classes = learningClasses(data, scoped); const results = learningResults(data, scoped);
  const lessons = [...learningLessons(data, scoped)].sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")).slice(0, 4);
  const identity = learningContext(data, scoped);
  return <><Welcome name={label(locale, identity.user)} title={t("welcome")} intro={t(role === "parent" ? "welcomeParent" : "welcomeStudent")} theme={role}><Link className="button" href={learningPath(role, scoped.childLinkId, "tasks")}>{t("tasks")}</Link><Link className="button secondary" href={learningPath(role, scoped.childLinkId, "classes")}>{t("classes")}</Link></Welcome><SubjectStrip title={t("exploreClasses")} intro={t("subjectStripHelp")} rows={classes.map(c => ({ id: c.id, name: label(locale, c.subject), subject: `${c.subject.name} ${c.subject.nameAr}`, detail: `${label(locale, c.grade)} · ${label(locale, c.section)}`, href: learningPath(role, scoped.childLinkId, "classes", c.id) }))} /><div className="workspace-metrics">{[{ key: "classes", n: classes.length, page: "classes" }, { key: "pendingTasks", n: summary.pending, page: "tasks" }, { key: "submitted", n: summary.submitted, page: "tasks" }, { key: "releasedResults", n: summary.released, page: "results" }].map(m => <Link href={learningPath(role, scoped.childLinkId, m.page)} key={m.key}><span className="metric-icon"><NavigationIcon page={m.page} /></span><span>{t(m.key)}</span><strong>{number(locale, m.n)}</strong></Link>)}</div>
    {!classes.length && <LearningEmpty title="noEnrollment" body="noEnrollmentHelp" />}
    <LearningPanel title="upcomingDeadlines"><TaskCards rows={summary.upcoming.slice(0, 5)} role={role} scoped={scoped} /></LearningPanel>
    <LearningPanel title="recentLessons"><LessonCards rows={lessons} role={role} scoped={scoped} /></LearningPanel>
    <LearningPanel title="releasedResults">{results.length ? <div className="learning-list">{results.slice(0, 3).map(r => <Link key={r.id} className="learning-row" href={learningPath(role, scoped.childLinkId, "results", r.id)}><strong>{label(locale, r)}</strong><span>{number(locale, r.earned)} / {number(locale, r.maximum)}</span></Link>)}</div> : <LearningEmpty title="noReleased" body="privateGrading" />}</LearningPanel>
    <LearningAnnouncements role={role} scoped={scoped} compact />
  </>;
}
export function LearningTasks({ role, scoped, now }: { role: LearningRole; scoped: Session; now: number }) {
  const { data, t, locale } = useWorkspace(); const [query, setQuery] = useState(""); const [classId, setClass] = useState(""); const [status, setStatus] = useState(""); const [type, setType] = useState(""); const [page, setPage] = useState(1);
  if (!data) return null;
  const classes = learningClasses(data, scoped); const all = learningTasks(data, scoped, now); const rows = all.filter(t => (!classId || t.classId === classId) && (!status || t.status === status) && (!type || t.type === type) && `${t.name} ${t.nameAr}`.toLowerCase().includes(query.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(rows.length / 8)); const current = Math.min(page, pages);
  return <section className="panel"><div className="toolbar"><label className="search-field">{t("search")}<input type="search" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} /></label><label>{t("subjectId")}<select value={classId} onChange={e => { setClass(e.target.value); setPage(1); }}><option value="">{t("all")}</option>{classes.map(c => <option key={c.id} value={c.id}>{label(locale, c.subject)}</option>)}</select></label><label>{t("status")}<select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">{t("all")}</option>{["upcoming", "submitted", "late", "missing", "resultAvailable"].map(s => <option value={s} key={s}>{t(s)}</option>)}</select></label><label>{t("type")}<select value={type} onChange={e => { setType(e.target.value); setPage(1); }}><option value="">{t("all")}</option><option value="assignment">{t("assignment")}</option><option value="exam">{t("exam")}</option></select></label><button className="button secondary" onClick={() => { setQuery(""); setClass(""); setStatus(""); setType(""); setPage(1); }}>{t("resetFilters")}</button></div><p className="result-summary" role="status">{number(locale, rows.length)} {t("results")}</p><div className="learning-panel">{rows.length || !all.length ? <TaskCards rows={rows.slice((current - 1) * 8, current * 8)} role={role} scoped={scoped} /> : <LearningEmpty title="noMatches" body="filterHelp" />}</div><Pager current={current} total={pages} change={setPage} /></section>;
}
export function LearningLessons({ role, scoped }: { role: LearningRole; scoped: Session }) {
  const { data, locale, t } = useWorkspace(); const [classId, setClass] = useState(""); const [query, setQuery] = useState(""); if (!data) return null;
  const classes = learningClasses(data, scoped); const all = learningLessons(data, scoped); const lessons = all.filter(l => (!classId || l.classId === classId) && `${l.name} ${l.nameAr} ${l.body}`.toLowerCase().includes(query.trim().toLowerCase()));
  const units = [...new Map(lessons.map(l => [l.unit.id, l.unit] as const)).values()];
  return <><div className="panel toolbar"><label className="search-field">{t("search")}<input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label><label>{t("subjectId")}<select value={classId} onChange={e => setClass(e.target.value)}><option value="">{t("all")}</option>{classes.map(c => <option key={c.id} value={c.id}>{label(locale, c.subject)}</option>)}</select></label></div>{!lessons.length && <LearningEmpty title={all.length ? "noMatches" : "learningEmpty"} body={all.length ? "filterHelp" : "learningEmptyHelp"} />}{units.map(unit => <section className="panel learning-panel" key={unit.id}><h2>{label(locale, unit)}</h2><LessonCards rows={lessons.filter(l => l.unit.id === unit.id)} role={role} scoped={scoped} /></section>)}</>;
}
export function TaskDetail({ task, role, scoped }: { task: TaskView; role: LearningRole; scoped: Session }) {
  const { locale, t } = useWorkspace();
  return <LearningPanel title="tasks"><h2>{label(locale, task)}</h2><div className="actions"><Badge value={task.status} /><Badge value={task.type} /></div><p className="long-content">{task.instructions}</p><dl className="learning-definitions"><div><dt>{t("opensLabel")}</dt><dd>{date(locale, task.opensAt)}</dd></div><div><dt>{t("deadlineLabel")}</dt><dd>{date(locale, task.dueAt)}</dd></div><div><dt>{t("questions")} / {t("marks")}</dt><dd>{number(locale, task.questionCount)} / {number(locale, task.maxMarks)}</dd></div></dl><p className="banner">{t(task.window)}</p><p className="muted">{t(role === "parent" ? "parentReadOnly" : "attemptRules")}</p>
    {task.draft && <p className="muted">{t("answerDraft")} · {t("draftUpdated")}: {date(locale, task.draft.updatedAt)}</p>}
    <div className="actions">{task.canAttempt && role === "student" && <Link className="button" href={learningPath(role, undefined, "tasks", task.id, true)}>{t(task.draft ? "resumeAttempt" : "startAttempt")}</Link>}{task.receipt && <><p>{t(task.receipt.stage)}</p><Link className="button secondary" href={learningPath(role, scoped.childLinkId, "submissions", task.receipt.id)}>{t("receipt")}</Link></>}</div>
  </LearningPanel>;
}
export function LearningResults({ role, scoped, id }: { role: LearningRole; scoped: Session; id?: string }) {
  const { data, locale, t } = useWorkspace(); const [classId, setClass] = useState(""); if (!data) return null;
  const rows = learningResults(data, scoped); const result = id ? rows.find(r => r.id === id) : undefined;
  if (id && !result) return <LearningEmpty title="unavailableRecord" body="privateGrading" />;
  if (result) return <LearningPanel title="releasedResults"><h2>{label(locale, result)}</h2><p className="result-total">{number(locale, result.earned)} / {number(locale, result.maximum)}</p><p className="muted">{t("releasedAt")}: {date(locale, result.releasedAt)}</p><h3>{t("breakdown")}</h3>{result.breakdown.map(g => <article className="result-question" key={g.question.id}><h3>{label(locale, g.question)}</h3><p>{t("response")}: {t(g.response)}</p><strong>{number(locale, g.score)} / {number(locale, g.question.points)}</strong>{g.feedback && <p className="long-content">{t("feedback")}: {g.feedback}</p>}</article>)}</LearningPanel>;
  const pending = learningTasks(data, scoped).filter(t => t.receipt && t.receipt.stage !== "released" && (!classId || t.classId === classId));
  return <><section className="panel learning-panel"><h2>{t("releasedResults")}</h2><p className="muted">{t("privateGrading")}</p><label>{t("subjectId")}<select value={classId} onChange={e => setClass(e.target.value)}><option value="">{t("all")}</option>{learningClasses(data, scoped).map(c => <option value={c.id} key={c.id}>{label(locale, c.subject)}</option>)}</select></label>{!rows.filter(r => !classId || r.classId === classId).length && <LearningEmpty title="noReleased" body="privateGrading" />}{rows.filter(r => !classId || r.classId === classId).map(r => <Link key={r.id} className="learning-row" href={learningPath(role, scoped.childLinkId, "results", r.id)}><div><strong>{label(locale, r)}</strong><small className="muted">{date(locale, r.releasedAt)}</small></div><span>{number(locale, r.earned)} / {number(locale, r.maximum)}</span></Link>)}</section>{pending.length > 0 && <LearningPanel title="awaitingRelease"><TaskCards rows={pending.filter(t => !classId || t.classId === classId)} role={role} scoped={scoped} /></LearningPanel>}</>;
}
export function LearningAnnouncements({ role, scoped, id, compact = false }: { role: LearningRole; scoped: Session; id?: string; compact?: boolean }) {
  const { data, locale, t } = useWorkspace(); if (!data) return null;
  let rows = learningAnnouncements(data, scoped); if (id) rows = rows.filter(a => a.id === id); if (compact) rows = rows.slice(0, 3);
  return <LearningPanel title="announcements">{!rows.length && <LearningEmpty />}{rows.map(a => <article className="announcement-row" key={a.id}><h3>{label(locale, a)}</h3><p className="long-content">{a.body}</p>{!id && <Link className="text-link" href={learningPath(role, scoped.childLinkId, "announcements", a.id)}>{t("view")}</Link>}</article>)}</LearningPanel>;
}
export function LearningNotifications({ role, scoped, id }: { role: LearningRole; scoped: Session; id?: string }) {
  const w = useWorkspace(); const { data, locale, t, busy } = w; const [status, setStatus] = useState(""); if (!data) return null;
  const rows = learningNotifications(data, scoped).filter(n => (!id || n.id === id) && (!status || n.read === (status === "read")));
  return <LearningPanel title="notifications">{!id && <label>{t("status")}<select value={status} onChange={e => setStatus(e.target.value)}><option value="">{t("all")}</option><option value="read">{t("read")}</option><option value="unread">{t("unread")}</option></select></label>}{!rows.length && <LearningEmpty />}{rows.map(n => <article className="announcement-row" key={`${n.id}:${n.destination?.childLinkId ?? ""}`}><div className="actions"><h3>{n.available ? label(locale, n) : t("unavailableRecord")}</h3><Badge value={n.read ? "read" : "unread"} /></div><p className="muted">{n.child && `${label(locale, n.child)} · `}{label(locale, n.school)} · {date(locale, n.at)}</p>{id && n.body && <p className="long-content">{n.body}</p>}<div className="actions"><button className="button secondary" disabled={busy} onClick={() => void w.runLearning({ type: "readLearningNotification", id: n.id, read: !n.read }, scoped.childLinkId)}>{t(n.read ? "markUnread" : "markRead")}</button>{n.destination && <Link className="button secondary" href={learningPath(role, n.destination.childLinkId ?? scoped.childLinkId, n.destination.page, n.destination.id)}>{t("destination")}</Link>}{!id && <Link className="text-link" href={learningPath(role, n.destination?.childLinkId ?? scoped.childLinkId, "notifications", n.id)}>{t("view")}</Link>}</div></article>)}</LearningPanel>;
}
export function LearningProfile() {
  const { data, session, locale, t } = useWorkspace(); if (!data) return null; const profile = learningProfile(data, session);
  return <><LearningPanel title="profile"><h2>{label(locale, profile.user)}</h2><p dir="ltr" className="learning-email">{profile.user.email}</p><p className="muted">{t("profileHelp")}</p><Language />{profile.school && <p>{label(locale, profile.school)}</p>}{profile.enrollments.map((e, i) => <p key={i}>{label(locale, e.grade)} · {label(locale, e.section)} · {label(locale, e.year)}</p>)}</LearningPanel>{profile.role === "parent" && <ChildrenOverview />}</>;
}
