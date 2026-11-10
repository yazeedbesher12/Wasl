"use client";
import Link from "next/link";
import { context, date, displayRecord, get, label, metrics, number, visible } from "@wasl/shared/demo";
import { useWorkspace } from "./provider";
import { RecordRows } from "./records";
import { Blank } from "./ui";
import { NavigationIcon, SubjectStrip, Welcome } from "../education";

export function Dashboard({ role }: { role: string }) {
  const { data, session, t, locale } = useWorkspace(); if (!data) return null;
  const c = context(data, session); const yearId = visible(data, session, "preferences").find(p => p.active)?.values.currentYearId;
  const year = yearId ? get(data, "years", yearId) : visible(data, session, "years").find(y => y.active);
  const events = data.events.filter(e => e.schoolId === c.school.id && (c.admin || visible(data, session, e.kind).some(r => r.id === e.recordId))).slice(0, 8);
  return <><Welcome name={label(locale, c.user)} title={t("welcome")} intro={t(c.admin ? "welcomeSchool" : "welcomeTeacher")} theme={c.admin ? "school" : "teacher"}><Link className="button" href={`/${role}/${c.admin ? "memberships" : "lessons"}`}>{t(c.admin ? "memberships" : "lessons")}</Link><Link className="button secondary" href={`/${role}/${c.admin ? "academics" : "classes"}`}>{t(c.admin ? "academics" : "classes")}</Link></Welcome>{!c.admin && <SubjectStrip title={t("exploreClasses")} intro={t("subjectStripHelp")} rows={visible(data, session, "assignments").map(a => { const subject = get(data, "subjects", a.values.subjectId); return { id: a.id, name: label(locale, subject), subject: `${subject?.name} ${subject?.nameAr}`, detail: label(locale, get(data, "sections", a.values.sectionId)), href: `/${role}/classes/${a.id}` }; })} />}<p className="workspace-year">{t("currentYear")}: {label(locale, year)}</p><div className="workspace-metrics">{metrics(data, session).map(m => <Link href={`/${role}/${m.page}`} key={m.label}><span className="metric-icon"><NavigationIcon page={m.page} /></span><span>{t(m.label)}</span><strong>{number(locale, m.value)}</strong></Link>)}</div><section className="quick-actions"><h2>{t("quickActions")}</h2><div className="actions">{(c.admin ? ["memberships", "assignments", "enrollments", "announcements"] : ["lessons", "assessments", "submissions"]).map(p => <Link className="button secondary" key={p} href={`/${role}/${p}`}><NavigationIcon page={p} />{t(p)}</Link>)}</div></section>
    {!c.admin && <RecordRows kind="assignments" rows={visible(data, session, "assignments")} role={role} title="classes" />}
    <RecordRows kind="announcements" rows={visible(data, session, "announcements").filter(a => a.active && a.values.status === "published")} role={role} title="announcements" compact />
    <section className="panel"><div className="section-heading"><h2>{t("activity")}</h2></div>{events.length ? <ol className="timeline">{events.map(e => <li key={e.id}><div><strong>{t(e.verb)} · {t(e.kind)}</strong><span>{label(locale, get(data, "users", e.actorId))}</span><span className="muted">{displayRecord(data, e.kind, get(data, e.kind, e.recordId)!, locale === "ar")}</span></div><time dateTime={e.at}>{date(locale, e.at)}</time></li>)}</ol> : <Blank />}</section>
  </>;
}
