import { useEffect, useState } from "react";
import { View } from "react-native";
import { DemoError, date, label, learningAnnouncements, learningChildren, learningClasses, learningContext, learningIdentity, learningLessons, learningNav, learningNotifications, learningReceipt, learningTasks } from "../../../../packages/shared/src/demo";
import type { LearningRole } from "../../../../packages/shared/src/demo";
import { useNative } from "../context";
import { Badge, Button, Card, Select, styles, Txt } from "../ui";
import { NativeNavigation } from "../education";
import { NativeAssessmentAttempt } from "./attempt";
import { NativeChildren, NativeClassCards, NativeLearningAnnouncements, NativeLearningContext, NativeLearningDashboard, NativeLearningEmpty, NativeLearningLessons, NativeLearningNotifications, NativeLearningProfile, NativeLearningResults, NativeLearningTasks, NativeLessonCards, NativeResource, NativeTaskCards, NativeTaskDetail } from "./content";

export function NativeLearningPage({ role }: { role: LearningRole }) {
  const n = useNative(); const { data, session, route, t, locale, go } = n;
  const childLinkId = role === "parent" ? route.childLinkId ?? session.childLinkId : undefined; const scoped = { membershipId: session.membershipId, childLinkId };
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);
  let children: ReturnType<typeof learningChildren> = [];
  try { if (data && role === "parent") children = learningChildren(data, session); } catch { /* The unavailable view below provides recovery. */ }
  const validChild = children.some(c => c.linkId === childLinkId);
  useEffect(() => { if (validChild && childLinkId) n.selectChildLink(childLinkId); }, [childLinkId, validChild, session.childLinkId]);
  if (!data) return <Txt>{t("loading")}</Txt>;
  let content; let showContext = false;
  try {
    if (learningIdentity(data, session).role !== role || route.edit || route.attempt && (role !== "student" || route.page !== "tasks" || !route.id)) throw new DemoError("unavailable");
    const page = route.page; const id = route.id;
    if (page === "more") content = <NativeNavigation pages={learningNav(role)} open={page => go({ page })} label={p => t(p === "results" ? "releasedResults" : p === "classes" && role === "parent" ? "childClasses" : p)} />;
    else if (page === "children" && role === "parent" && !id) content = <NativeChildren welcome />;
    else if (page === "profile" && !id) content = <NativeLearningProfile />;
    else {
      if (![...learningNav(role), "resources", "submissions", "lessons"].includes(page)) throw new DemoError("unavailable");
      learningContext(data, scoped); showContext = true;
      if (page === "dashboard" && !id) content = <NativeLearningDashboard scoped={scoped} now={now} />;
      else if (page === "classes") {
        const classes = learningClasses(data, scoped); const c = id ? classes.find(c => c.id === id) : undefined; if (id && !c) throw new DemoError("unavailable");
        content = c ? <View><NativeClassCards rows={[c]} /><Txt style={styles.sectionTitle}>{t("lessons")}</Txt><NativeLessonCards rows={learningLessons(data, scoped).filter(l => l.classId === c.id)} /><Txt style={styles.sectionTitle}>{t("tasks")}</Txt><NativeTaskCards rows={learningTasks(data, scoped, now).filter(t => t.classId === c.id)} /><Txt style={styles.sectionTitle}>{t("announcements")}</Txt>{learningAnnouncements(data, scoped).filter(a => !a.classId || a.classId === c.id).map(a => <Card key={a.id}><Txt style={{ fontWeight: "700" }}>{label(locale, a)}</Txt><Txt>{a.body}</Txt></Card>)}</View> : <NativeClassCards rows={classes} />;
      } else if (page === "lessons") {
        const lesson = id ? learningLessons(data, scoped).find(l => l.id === id) : undefined; if (id && !lesson) throw new DemoError("unavailable");
        content = lesson ? <View><Card><Txt muted>{label(locale, lesson.unit)}</Txt><Txt title>{label(locale, lesson)}</Txt><Txt>{lesson.body}</Txt></Card><Txt style={styles.sectionTitle}>{t("resources")}</Txt>{lesson.resources.length ? lesson.resources.map(r => <NativeResource resource={r} key={r.id} />) : <NativeLearningEmpty />}</View> : <NativeLearningLessons scoped={scoped} />;
      } else if (page === "resources" && id) {
        const resource = learningLessons(data, scoped).flatMap(l => l.resources).find(r => r.id === id); if (!resource) throw new DemoError("unavailable"); content = <NativeResource resource={resource} />;
      } else if (page === "tasks") {
        const task = id ? learningTasks(data, scoped, now).find(t => t.id === id) : undefined; if (id && !task) throw new DemoError("unavailable");
        content = task ? route.attempt ? <NativeAssessmentAttempt key={`${session.membershipId}:${task.id}`} task={task} /> : <NativeTaskDetail task={task} parent={role === "parent"} /> : <NativeLearningTasks scoped={scoped} now={now} />;
      } else if (page === "submissions" && id) {
        const receipt = learningReceipt(data, scoped, id);
        content = <View><Card><Txt title>{t("submissionReceived")}</Txt><Txt>{label(locale, receipt)}</Txt><Badge value={receipt.stage} /><Txt muted>{t("submittedAt")}: {date(locale, receipt.submittedAt)}</Txt><Txt muted ltr>{receipt.id}</Txt><Txt muted>{t("privateGrading")}</Txt><Txt muted>{t("attemptRules")}</Txt>{receipt.stage === "released" && <Button onPress={() => go({ page: "results", id: receipt.id })}>{t("releasedResults")}</Button>}</Card>{receipt.responses?.map(a => <Card key={a.question.id}><Txt style={{ fontWeight: "700" }}>{label(locale, a.question)}</Txt><Txt>{t("response")}: {t(a.response)}</Txt>{a.filename && <Txt muted>{a.filename} · {t("attachmentNotice")}</Txt>}</Card>)}</View>;
      } else if (page === "results") content = <NativeLearningResults scoped={scoped} id={id} />;
      else if (page === "announcements") { if (id && !learningAnnouncements(data, scoped).some(a => a.id === id)) throw new DemoError("unavailable"); content = <NativeLearningAnnouncements scoped={scoped} id={id} />; }
      else if (page === "notifications") { if (id && !learningNotifications(data, scoped).some(n => n.id === id)) throw new DemoError("unavailable"); content = <NativeLearningNotifications scoped={scoped} id={id} />; }
      else throw new DemoError("unavailable");
    }
  } catch (e) { content = <Card><Txt accessibilityRole="alert">{t(e instanceof DemoError ? e.code : "unavailable")}</Txt>{role === "parent" && <Button secondary onPress={() => go({ page: "children" })}>{t("children")}</Button>}<Button secondary onPress={() => go({ page: "entry" })}>{t("switchAccount")}</Button></Card>; }
  return <View>{role === "parent" && !!children.length && <Card><Select label={t("selectedChild")} value={validChild ? childLinkId ?? "" : ""} options={children.map(c => ({ value: c.linkId, label: `${label(locale, c.student)} · ${label(locale, c.school)}` }))} onChange={id => { n.selectChildLink(id); go({ page: "dashboard", childLinkId: id }); }} /></Card>}{showContext && <NativeLearningContext scoped={scoped} />}{role === "parent" && showContext && <Txt muted style={{ marginBottom: 18 }}>{t("parentReadOnly")}</Txt>}{content}</View>;
}
