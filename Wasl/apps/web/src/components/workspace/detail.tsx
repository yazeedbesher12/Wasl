"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { canEdit, context, date, displayRecord, get, gradingValues, number, pageAllowed, questionRows, recordStatus, related, resultTotal, schema, totalMarks, transitions } from "@wasl/shared/demo";
import type { Command, DemoRecord, Kind } from "@wasl/shared/demo";
import { useWorkspace } from "./provider";
import { Badge, Modal } from "./ui";
import { RecordRows } from "./records";

function Grading({ row }: { row: DemoRecord }) {
  const w = useWorkspace(); const { data, t, locale, run, busy } = w;
  const questions = data ? questionRows(data, row.values.assessmentId) : [];
  const [values, setValues] = useState(() => data ? gradingValues(data, row).map(g => ({ ...g, score: w.drafts.current[`grading:${row.id}`]?.values[g.questionId] ?? g.score, feedback: w.drafts.current[`grading:${row.id}`]?.values[`feedback:${g.questionId}`] ?? g.feedback })) : []);
  const baseline = useRef(JSON.stringify(data ? gradingValues(data, row) : []));
  const key = `grading:${row.id}`;
  useEffect(() => { w.draftKey.current = key; w.drafts.current[key] = { name: "", nameAr: "", values: Object.fromEntries(values.flatMap(g => [[g.questionId, g.score], [`feedback:${g.questionId}`, g.feedback]])) }; w.setDirty(JSON.stringify(values) !== baseline.current); return () => w.setDirty(false); }, [values, key, w.draftKey, w.drafts, w.setDirty]);
  if (!data) return null;
  return <form className="panel grading-panel" noValidate onSubmit={async e => { e.preventDefault(); if (await run({ type: "grade", id: row.id, scores: values })) { baseline.current = JSON.stringify(values); w.setDirty(false); } }}><h2>{t("grade")}</h2><p className="muted">{t("gradedHelp")}</p>{questions.map((q, i) => {
    const answer = data.records.answers.find(a => a.values.submissionId === row.id && a.values.questionId === q.id);
    return <section className="grading-question" key={q.id}><h3>{displayRecord(data, "questions", q, locale === "ar")} · {number(locale, Number(q.values.points))} {t("marks")}</h3><p className="answer-content">{t("response")}: {t(answer?.values.response || "optional")}</p>{answer?.values.filename && <p className="muted">{answer.values.filename} · {t("attachmentNotice")}</p>}<p className="muted">{t("correct")}: {t(q.values.correct)}</p><div className="form-grid"><label>{t("marks")}<input id={`field-${q.id}`} type="number" min={0} max={Number(q.values.points)} step="any" value={values[i].score} disabled={busy} aria-invalid={w.error?.field === q.id} onChange={e => setValues(values.map((g, idx) => idx === i ? { ...g, score: e.target.value } : g))} />{w.error?.field === q.id && <span className="field-error">{t(w.error.code)}</span>}</label><label>{t("feedback")}<textarea rows={3} value={values[i].feedback} disabled={busy} onChange={e => setValues(values.map((g, idx) => idx === i ? { ...g, feedback: e.target.value } : g))} /></label></div></section>;
  })}<button className="button" disabled={busy}>{t(busy ? "working" : "saveGrading")}</button></form>;
}
export function RecordDetail({ kind, row, role }: { kind: Kind; row: DemoRecord; role: string }) {
  const w = useWorkspace(); const { data, session, t, locale, busy, run } = w;
  const [confirm, setConfirm] = useState("");
  if (!data) return null;
  const actions = transitions(data, session, kind, row);
  const panels = related(data, session, kind, row).filter(p => pageAllowed(data, session, p.kind));
  const canGrade = kind === "submissions" && row.values.status !== "released" && !context(data, session).admin;
  const fields = [...schema[kind].fields, ...(kind === "users" ? [] : [])];
  return <><section className="panel profile-panel"><div className="section-heading detail-heading"><div><h2>{displayRecord(data, kind, row, locale === "ar")}</h2><Badge value={recordStatus(kind, row)} /></div><div className="actions">{canEdit(data, session, kind, row) && <Link className="button secondary" href={`/${role}/${kind}/${row.id}/edit`}>{t("edit")}</Link>}{actions.map(verb => <button key={verb} className={`button ${verb === "archive" || verb === "revoke" ? "danger-outline" : "secondary"}`} disabled={busy} onClick={() => verb === "read" || verb === "unread" ? void run({ type: "transition", kind, id: row.id, verb }) : setConfirm(verb)}>{t(verb === "read" ? "markRead" : verb === "unread" ? "markUnread" : verb)}</button>)}</div></div>
    <dl className="definition-list"><div><dt>{t("recordId")}</dt><dd dir="ltr">{row.id}</dd></div>{fields.map(f => {
      const value = kind === "memberships" && f.key === "email" ? get(data, "users", row.values.userId)?.values.email ?? "" : row.values[f.key]; const target = f.ref && get(data, f.ref, value);
      return <div key={f.key}><dt>{t(f.key)}</dt><dd className={f.type === "long" ? "long-content" : ""} dir={["email", "url", "filename"].includes(f.key) ? "ltr" : undefined}>{target ? <>{displayRecord(data, f.ref!, target, locale === "ar")}</> : f.type === "date" ? date(locale, value) : f.type === "number" ? number(locale, Number(value)) : f.key === "url" && value ? <a className="text-link" target="_blank" rel="noreferrer" href={value}>{value}</a> : t(value || "optional")}</dd></div>;
    })}{kind === "assessments" && <div><dt>{t("questions")} / {t("marks")}</dt><dd>{number(locale, questionRows(data, row.id).length)} / {number(locale, totalMarks(data, row.id))}</dd></div>}{kind === "submissions" && <div><dt>{t("total")}</dt><dd>{resultTotal(data, row.id) === undefined ? t("noGrade") : `${number(locale, resultTotal(data, row.id)!)} / ${number(locale, totalMarks(data, row.values.assessmentId))}`}</dd></div>}</dl>
    {(kind === "resources" && row.values.type === "file" || kind === "answers" && row.values.filename) && <p className="banner">{t("attachmentNotice")}</p>}
    {kind === "notifications" && row.values.targetKind && <Link className="button secondary" href={`/${role}/${row.values.targetKind}/${row.values.targetId}`}>{t("destination")}</Link>}
  </section>
  {kind === "assessments" && row.values.status === "draft" && <Link className="button workspace-add-related" href={`/${role}/assessmentQuestions/new`}>{t("create")} · {t("assessmentQuestions")}</Link>}
  {canGrade && <Grading key={row.id} row={row} />}
  {panels.map(p => <RecordRows key={p.kind} kind={p.kind} rows={p.rows} role={role} title={p.title ?? p.kind} />)}
  {confirm && <Modal title={t(confirm)} busy={busy} close={() => setConfirm("")}><p>{t("confirmChange")}</p>{w.error && <p role="alert" className="field-error">{t(w.error.code)}</p>}<div className="dialog-actions"><button className="button secondary" disabled={busy} onClick={() => setConfirm("")}>{t("cancel")}</button><button className="button" disabled={busy} onClick={async () => { if (await run({ type: "transition", kind, id: row.id, verb: confirm as Extract<Command, { type: "transition" }>["verb"] })) setConfirm(""); }}>{t(busy ? "working" : "confirm")}</button></div></Modal>}
  </>;
}
