"use client";
import Link from "next/link";
import { useState } from "react";
import { date, displayRecord, filtered, get, number, recordStatus, resultTotal, schema, totalMarks, visible } from "@wasl/shared/demo";
import type { DemoRecord, Kind } from "@wasl/shared/demo";
import { useWorkspace } from "./provider";
import { Badge, Blank, Pager } from "./ui";
import { EducationArt } from "../education";

export function RecordRows({ kind, rows, role, title, compact = false }: { kind: Kind; rows: DemoRecord[]; role: string; title?: string; compact?: boolean }) {
  const { data, locale, t } = useWorkspace(); const [page, setPage] = useState(1);
  if (!data) return null;
  const max = Math.max(1, Math.ceil(rows.length / 8)); const current = Math.min(page, max);
  const fields = schema[kind].fields.filter(f => !["choices", "correct", "body", "instructions"].includes(f.key)).slice(0, compact ? 1 : 3);
  if (kind === "assignments" && role === "teacher") return <section>{title && <div className="subject-heading class-list-heading"><h2>{t(title)}</h2></div>}{rows.length ? <div className="learning-cards">{rows.slice((current - 1) * 8, current * 8).map(row => {
    const subject = get(data, "subjects", row.values.subjectId);
    return <article key={row.id} className="panel learning-card subject-class-card"><div className="class-illustration"><EducationArt subject={`${subject?.name} ${subject?.nameAr}`} /></div><h2>{displayRecord(data, kind, row, locale === "ar")}</h2><Badge value={recordStatus(kind, row)} />{fields.map(f => { const value = row.values[f.key]; return <p key={f.key} className="muted">{t(f.key)}: {f.ref ? displayRecord(data, f.ref, get(data, f.ref, value) ?? row, locale === "ar") : t(value || "optional")}</p>; })}<Link className="button secondary" href={`/${role}/${kind}/${row.id}`}>{t("view")}<span className="sr-only"> {displayRecord(data, kind, row, locale === "ar")}</span></Link></article>;
  })}</div> : <Blank />}{rows.length > 8 && <Pager current={current} total={max} change={setPage} />}</section>;
  return <section className="panel workspace-records">{title && <div className="section-heading"><h2>{t(title)}</h2></div>}{!rows.length ? <Blank /> : <div className="table-scroll" tabIndex={0} role="region" aria-label={t(title ?? kind)}><table><thead><tr><th scope="col">{t(kind)}</th>{fields.map(f => <th scope="col" key={f.key}>{t(f.key)}</th>)}<th scope="col">{t("status")}</th>{kind === "submissions" && <th scope="col">{t("marks")}</th>}<th scope="col">{t("view")}</th></tr></thead><tbody>{rows.slice((current - 1) * 8, current * 8).map(row => <tr key={row.id}><th scope="row"><Link href={`/${role}/${kind}/${row.id}`}>{displayRecord(data, kind, row, locale === "ar")}</Link></th>{fields.map(f => {
    const value = kind === "memberships" && f.key === "email" ? get(data, "users", row.values.userId)?.values.email ?? "" : row.values[f.key];
    return <td key={f.key} dir={f.key === "email" ? "ltr" : undefined}>{f.ref ? displayRecord(data, f.ref, get(data, f.ref, value) ?? row, locale === "ar") : f.type === "date" ? date(locale, value) : f.type === "number" ? number(locale, Number(value)) : t(value || "optional")}</td>;
  })}<td><Badge value={recordStatus(kind, row)} /></td>{kind === "submissions" && <td>{resultTotal(data, row.id) === undefined ? t("noGrade") : `${number(locale, resultTotal(data, row.id)!)} / ${number(locale, totalMarks(data, row.values.assessmentId))}`}</td>}<td><Link className="text-link" href={`/${role}/${kind}/${row.id}`}>{t("view")}<span className="sr-only"> {displayRecord(data, kind, row, locale === "ar")}</span></Link></td></tr>)}</tbody></table></div>}{rows.length > 8 && <Pager current={current} total={max} change={setPage} />}</section>;
}
export function RecordList({ kind, role }: { kind: Kind; role: string }) {
  const { data, session, locale, t } = useWorkspace();
  const [search, setSearch] = useState(""); const [status, setStatus] = useState(""); const [classFilter, setClass] = useState(""); const [roleFilter, setRole] = useState(""); const [assessment, setAssessment] = useState("");
  if (!data) return null;
  const rows = filtered(data, session, kind, locale, search, status, classFilter, roleFilter, assessment);
  const all = visible(data, session, kind); const statuses = [...new Set(all.map(r => recordStatus(kind, r)))];
  const classes = visible(data, session, "assignments");
  const reset = () => { setSearch(""); setStatus(""); setClass(""); setRole(""); setAssessment(""); };
  return <><div className="panel filter-panel"><div className="toolbar"><label className="search-field">{t("search")}<input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label><label>{t("status")}<select value={status} onChange={e => setStatus(e.target.value)}><option value="">{t("all")}</option>{statuses.map(v => <option key={v} value={v}>{t(v)}</option>)}</select></label>{kind === "memberships" && <label>{t("role")}<select value={roleFilter} onChange={e => setRole(e.target.value)}><option value="">{t("all")}</option>{["SCHOOL_ADMIN", "TEACHER", "STUDENT", "PARENT"].map(r => <option key={r} value={r}>{t(r)}</option>)}</select></label>}{role === "teacher" && !["assignments", "users", "notifications"].includes(kind) && <label>{t("filterClass")}<select value={classFilter} onChange={e => setClass(e.target.value)}><option value="">{t("all")}</option>{classes.map(c => <option key={c.id} value={c.id}>{displayRecord(data, "assignments", c, locale === "ar")}</option>)}</select></label>}{kind === "submissions" && <label>{t("assessmentId")}<select value={assessment} onChange={e => setAssessment(e.target.value)}><option value="">{t("all")}</option>{visible(data, session, "assessments").map(a => <option key={a.id} value={a.id}>{displayRecord(data, "assessments", a, locale === "ar")}</option>)}</select></label>}<button className="button secondary" onClick={reset}>{t("resetFilters")}</button></div><p className="result-summary" role="status">{number(locale, rows.length)} {t("results")}</p></div>{rows.length ? <RecordRows key={`${kind}-${search}-${status}-${classFilter}-${roleFilter}-${assessment}`} kind={kind} rows={rows} role={role} /> : <section className="panel"><Blank filtered={all.length > 0} /></section>}</>;
}
