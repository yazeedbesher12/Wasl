"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DemoError, label, learningAnnouncements, learningChildren, learningClasses, learningContext, learningIdentity, learningLessons, learningNav, learningNotifications, learningPath, learningReceipt, learningTasks, date } from "@wasl/shared/demo";
import type { LearningRole } from "@wasl/shared/demo";
import { useWorkspace } from "../provider";
import { WorkspaceShell } from "../shell";
import { Badge } from "../ui";
import { AssessmentAttempt } from "./attempt";
import { ChildrenOverview, ClassCards, LearningAnnouncements, LearningContextBar, LearningDashboard, LearningEmpty, LearningLessons, LearningNotifications, LearningPanel, LearningProfile, LearningResults, LearningTasks, LessonCards, ResourceContent, TaskCards, TaskDetail } from "./content";

export function LearningPage({ role, path = [] }: { role: LearningRole; path?: string[] }) {
  const w = useWorkspace(); const { data, session, locale, t } = w;
  const explicitChild = role === "parent" && path[0] === "child";
  const childLinkId = role === "parent" ? explicitChild ? path[1] : session.childLinkId : undefined;
  const parts = explicitChild ? path.slice(2) : path; const page = parts[0] ?? (role === "parent" ? "children" : "dashboard"); const id = parts[1]; const mode = parts[2];
  const scoped = { membershipId: session.membershipId, childLinkId };
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);
  useEffect(() => { w.setError(undefined); }, [page, id, childLinkId, w.setError]);
  let children: ReturnType<typeof learningChildren> = [];
  try { if (data && role === "parent") children = learningChildren(data, session); } catch { /* The unavailable state below explains the invalid membership. */ }
  const validChild = children.some(c => c.linkId === childLinkId);
  useEffect(() => { if (validChild && childLinkId) w.selectChildLink(childLinkId); }, [validChild, childLinkId, session.childLinkId]);
  let content; let showContext = false;
  try {
    if (!data) content = <p role="status">{t("loading")}</p>;
    else {
      const identity = learningIdentity(data, session);
      if (identity.role !== role || parts.length > 3 || mode && (mode !== "attempt" || page !== "tasks" || !id || role !== "student") || explicitChild && !path[1]) throw new DemoError("unavailable");
      if (![...learningNav(role), "resources", "submissions", "lessons"].includes(page)) throw new DemoError("unavailable");
      if (page === "children" && role === "parent" && !id) content = <ChildrenOverview welcome />;
      else if (page === "profile" && !id) content = <LearningProfile />;
      else {
        learningContext(data, scoped); showContext = true;
        if (page === "dashboard" && !id) content = <LearningDashboard role={role} scoped={scoped} now={now} />;
        else if (page === "classes") {
          const classes = learningClasses(data, scoped); const c = id ? classes.find(c => c.id === id) : undefined;
          if (id && !c) throw new DemoError("unavailable");
          content = c ? <><ClassCards rows={[c]} role={role} scoped={scoped} /><LearningPanel title="lessons"><LessonCards rows={learningLessons(data, scoped).filter(l => l.classId === c.id)} role={role} scoped={scoped} /></LearningPanel><LearningPanel title="tasks"><TaskCards rows={learningTasks(data, scoped, now).filter(t => t.classId === c.id)} role={role} scoped={scoped} /></LearningPanel><LearningPanel title="announcements">{learningAnnouncements(data, scoped).filter(a => !a.classId || a.classId === c.id).map(a => <article key={a.id} className="announcement-row"><h3>{label(locale, a)}</h3><p className="long-content">{a.body}</p></article>)}</LearningPanel></> : <ClassCards rows={classes} role={role} scoped={scoped} />;
        } else if (page === "lessons") {
          const lesson = id ? learningLessons(data, scoped).find(l => l.id === id) : undefined;
          if (id && !lesson) throw new DemoError("unavailable");
          content = lesson ? <LearningPanel title="lessons"><small className="muted">{label(locale, lesson.unit)}</small><h2>{label(locale, lesson)}</h2><p className="lesson-body">{lesson.body}</p><h3>{t("resources")}</h3>{lesson.resources.length ? lesson.resources.map(r => <ResourceContent key={r.id} resource={r} />) : <LearningEmpty />}</LearningPanel> : <LearningLessons role={role} scoped={scoped} />;
        } else if (page === "resources" && id) {
          const resource = learningLessons(data, scoped).flatMap(l => l.resources).find(r => r.id === id); if (!resource) throw new DemoError("unavailable"); content = <LearningPanel title="resources"><ResourceContent resource={resource} /></LearningPanel>;
        } else if (page === "tasks") {
          const task = id ? learningTasks(data, scoped, now).find(t => t.id === id) : undefined;
          if (id && !task) throw new DemoError("unavailable");
          content = task ? mode === "attempt" ? <AssessmentAttempt key={`${session.membershipId}:${task.id}`} task={task} /> : <TaskDetail task={task} role={role} scoped={scoped} /> : <LearningTasks key={`${session.membershipId}:${childLinkId ?? ""}`} role={role} scoped={scoped} now={now} />;
        } else if (page === "submissions" && id) {
          const receipt = learningReceipt(data, scoped, id);
          content = <LearningPanel title="receipt"><h2>{t("submissionReceived")}</h2><h3>{label(locale, receipt)}</h3><Badge value={receipt.stage} /><p className="muted">{t("submittedAt")}: {date(locale, receipt.submittedAt)}</p><p dir="ltr" className="learning-email">{receipt.id}</p><p>{t("attemptRules")}</p><p className="muted">{t("privateGrading")}</p>{receipt.responses?.map(a => <article className="result-question" key={a.question.id}><h3>{label(locale, a.question)}</h3><p className="long-content">{t("response")}: {t(a.response)}</p>{a.filename && <p className="muted">{a.filename} · {t("attachmentNotice")}</p>}</article>)}{receipt.stage === "released" && <Link className="button" href={learningPath(role, childLinkId, "results", receipt.id)}>{t("releasedResults")}</Link>}</LearningPanel>;
        } else if (page === "results") content = <LearningResults key={`${session.membershipId}:${childLinkId ?? ""}:${id ?? ""}`} role={role} scoped={scoped} id={id} />;
        else if (page === "announcements") { if (id && !learningAnnouncements(data, scoped).some(a => a.id === id)) throw new DemoError("unavailable"); content = <LearningAnnouncements role={role} scoped={scoped} id={id} />; }
        else if (page === "notifications") { if (id && !learningNotifications(data, scoped).some(n => n.id === id)) throw new DemoError("unavailable"); content = <LearningNotifications key={`${session.membershipId}:${childLinkId ?? ""}:${id ?? ""}`} role={role} scoped={scoped} id={id} />; }
        else throw new DemoError("unavailable");
      }
    }
  } catch (e) { content = <div className="empty"><p role="alert">{t(e instanceof DemoError ? e.code : "unavailable")}</p><div className="actions learning-recovery">{role === "parent" && <Link className="button secondary" href="/parent/children">{t("children")}</Link>}<Link className="button secondary" href="/demo">{t("switchAccount")}</Link></div></div>; }
  return <WorkspaceShell role={role} page={page} childLinkId={childLinkId}><div className="learning-page"><header className={(page === "dashboard" || page === "children") && !id ? "sr-only" : "page-heading"}><div><h1>{t(page === "results" ? "releasedResults" : role === "parent" && page === "classes" ? "childClasses" : page)}</h1><p className="muted">{t(role === "parent" ? "parentIntro" : "learningIntro")}</p></div>{id && <Link className="button secondary" href={learningPath(role, childLinkId, page === "submissions" || page === "resources" ? "tasks" : page)}>{t("back")}</Link>}</header>
    {role === "parent" && children.length > 0 && <label className="child-switcher">{t("selectedChild")}<select value={validChild ? childLinkId : ""} disabled={w.busy} onChange={e => { if (e.target.value) { w.selectChildLink(e.target.value); w.navigate(learningPath(role, e.target.value, "dashboard")); } }}><option value="">{t("chooseChild")}</option>{children.map(c => <option key={c.linkId} value={c.linkId}>{label(locale, c.student)} · {label(locale, c.school)}</option>)}</select></label>}
    {showContext && <LearningContextBar scoped={scoped} />}{role === "parent" && showContext && <p className="learning-readonly muted">{t("parentReadOnly")}</p>}{content}
  </div></WorkspaceShell>;
}
