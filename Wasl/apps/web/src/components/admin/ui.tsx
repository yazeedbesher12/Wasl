"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Activity, School } from "@/lib/admin/model";
import type { Message } from "@/lib/admin/i18n";
import { useAdmin } from "./provider";
import { EducationArt } from "../education";

export function Heading({ title, intro, children }: { title: string; intro?: string; children?: ReactNode }) {
  return <header className="page-heading"><div><h1>{title}</h1>{intro && <p className="muted">{intro}</p>}</div><div className="actions">{children}</div></header>;
}
export function Empty({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  return <div className="empty"><EducationArt subject="" className="empty-illustration" /><h2>{title}</h2>{body && <p className="muted">{body}</p>}{children}</div>;
}
export function LanguageSwitch() {
  const { locale, setLocale, t } = useAdmin();
  return <div className="language-switch" role="group" aria-label={t("language")}><button type="button" lang="ar" aria-pressed={locale === "ar"} onClick={() => setLocale("ar")}>عربي</button><button type="button" lang="en" aria-pressed={locale === "en"} onClick={() => setLocale("en")}>English</button></div>;
}
export function Status({ active }: { active: boolean }) {
  const { t } = useAdmin();
  return <span className={`badge ${active ? "positive" : "warning"}`}><span aria-hidden="true" className="dot" />{t(active ? "active" : "suspended")}</span>;
}
// Native dialog provides focus trapping, Escape and background inertness.
export function Dialog({ title, children, onClose, busy = false, className = "" }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  const { t, notice } = useAdmin();
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (trigger?.isConnected) trigger.focus();
      else document.getElementById("main-content")?.focus();
    };
  }, []);
  return <dialog ref={ref} aria-labelledby={titleId} className={className} onCancel={e => { e.preventDefault(); if (!busy) closeRef.current(); }}>
    <div className="dialog-heading"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" disabled={busy} aria-label={t("close")} onClick={onClose}>×</button></div>{notice?.error && <p className="form-alert" role="alert">{t(notice.key)}</p>}{children}
  </dialog>;
}
export function SchoolActions({ school, detail = false }: { school: School; detail?: boolean }) {
  const { t, busy, setActive, schoolName } = useAdmin();
  const [confirm, setConfirm] = useState(false);
  return <div className="actions compact">
    {!detail && <Link className="text-link" href={`/admin/schools/${school.id}`}>{t("view")}<span className="sr-only"> {schoolName(school)}</span></Link>}
    <Link className={detail ? "button secondary" : "text-link"} href={`/admin/schools/${school.id}/edit`}>{t("edit")}<span className="sr-only"> {schoolName(school)}</span></Link>
    <button className={detail ? "button secondary" : "text-link"} disabled={busy} onClick={() => school.active ? setConfirm(true) : void setActive(school.id, true)}>{t(school.active ? "suspend" : "reactivate")}<span className="sr-only"> {schoolName(school)}</span></button>
    {confirm && <Dialog title={t("suspendTitle")} busy={busy} onClose={() => setConfirm(false)}><p><strong>{schoolName(school)}</strong></p><p className="muted">{t("suspendBody")}</p><div className="dialog-actions"><button className="button secondary" disabled={busy} onClick={() => setConfirm(false)}>{t("cancel")}</button><button className="button danger" disabled={busy} onClick={async () => { if (await setActive(school.id, false)) setConfirm(false); }}>{t(busy ? "working" : "suspend")}</button></div></Dialog>}
  </div>;
}
export function SchoolsTable({ schools, compact = false }: { schools: School[]; compact?: boolean }) {
  const { t, locale, schoolName, number } = useAdmin();
  return <div className="table-scroll" role="region" aria-label={t("directory")} tabIndex={0}><table><thead><tr><th scope="col">{t("school")}</th><th scope="col">{t("location")}</th>{!compact && <><th scope="col">{t("contact")}</th><th scope="col">{t("community")}</th></>}<th scope="col">{t("status")}</th><th scope="col">{t("actions")}</th></tr></thead><tbody>{schools.map(s => <tr key={s.id}>
    <th scope="row"><Link className="school-link" href={`/admin/schools/${s.id}`}><span className="school-avatar" aria-hidden="true">{schoolName(s).slice(0, 1)}</span><span>{schoolName(s)}<small className="muted" dir={locale === "ar" ? "ltr" : "rtl"}>{locale === "ar" ? s.name : s.nameAr}</small></span></Link></th>
    <td>{locale === "ar" ? s.demo.cityAr : s.demo.city}</td>{!compact && <><td>{locale === "ar" ? s.demo.administratorAr : s.demo.administrator}<a className="email" dir="ltr" href={`mailto:${s.demo.email}`}>{s.demo.email}</a></td><td><span title={t("students")}>{number(s.demo.students)}</span><span className="muted"> / </span><span title={t("teachers")}>{number(s.demo.teachers)}</span></td></>}
    <td><Status active={s.active} /></td><td>{compact ? <Link className="text-link" href={`/admin/schools/${s.id}`}>{t("view")}<span className="sr-only"> {schoolName(s)}</span></Link> : <SchoolActions school={s} />}</td>
  </tr>)}</tbody></table></div>;
}
export const actionLabel: Record<Activity["action"], Message> = { created: "created", edited: "edited", suspended: "schoolSuspended", reactivated: "schoolReactivated" };
export function ActivityList({ entries }: { entries: Activity[] }) {
  const { data, t, locale, schoolName, date } = useAdmin();
  if (!entries.length) return <Empty title={t("noActivity")} body={t("noActivityBody")} />;
  return <ol className="timeline">{entries.map(a => {
    const school = data?.schools.find(s => s.id === a.schoolId);
    return <li key={a.id}><span className={`activity-dot ${a.action === "suspended" ? "amber" : ""}`} aria-hidden="true" /><div><strong>{t(actionLabel[a.action])}</strong>{school && <Link href={`/admin/schools/${school.id}`}>{schoolName(school)}</Link>}<span className="muted">{t("actor")}: {locale === "ar" ? a.actorAr : a.actor}</span></div><time dateTime={a.at}>{date(a.at, true)}</time></li>;
  })}</ol>;
}
