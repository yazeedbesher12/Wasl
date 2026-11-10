"use client";
import { useEffect, useRef, useState } from "react";
import { date, label, number } from "@wasl/shared/demo";
import type { TaskView } from "@wasl/shared/demo";
import { useWorkspace } from "../provider";
import { Modal } from "../ui";
import { LearningEmpty } from "./content";

interface CachedAnswers { responses: Record<string, string>; revision: number; index: number }
export function AssessmentAttempt({ task }: { task: TaskView }) {
  const w = useWorkspace(); const { session, locale, t, busy, error } = w;
  const key = `attempt:${session.membershipId}:${task.id}`;
  const storageKey = `wasl.${key}`;
  const questionIds = task.questions.map(q => q.id).join("|");
  const [responses, setResponses] = useState<Record<string, string>>(() => w.drafts.current[key]?.values ?? task.draft?.responses ?? {});
  const [revision, setRevision] = useState(task.draft?.revision ?? 0);
  const [index, setIndex] = useState(0); const [confirm, setConfirm] = useState<"submit" | "load" | "">(""); const [ready, setReady] = useState(false);
  const baseline = useRef(JSON.stringify(task.draft?.responses ?? {}));
  const submitted = useRef(false);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) { const saved = JSON.parse(raw) as CachedAnswers; if (saved.responses && typeof saved.responses === "object" && !Array.isArray(saved.responses) && Object.values(saved.responses).every(v => typeof v === "string") && Number.isInteger(saved.revision) && saved.revision >= 0) { setResponses(saved.responses); setRevision(saved.revision); setIndex(Number.isInteger(saved.index) ? saved.index : 0); } }
    } catch { /* The shared saved draft remains available when session caching is blocked. */ }
    setReady(true);
  }, [storageKey]);
  useEffect(() => {
    if (!ready || submitted.current) return;
    w.draftKey.current = key; w.drafts.current[key] = { name: String(index), nameAr: "", values: responses }; w.setDirty(JSON.stringify(responses) !== baseline.current);
    try { sessionStorage.setItem(storageKey, JSON.stringify({ responses, revision, index })); } catch { /* Explicit save still persists through the shared adapter and reports failures. */ }
    return () => w.setDirty(false);
  }, [responses, revision, index, key, storageKey, ready, w.draftKey, w.drafts, w.setDirty]);
  useEffect(() => { if (!confirm && error?.field) { const i = questionIds.split("|").indexOf(error.field); if (i >= 0) { setIndex(i); requestAnimationFrame(() => document.getElementById(`answer-${error.field}`)?.focus()); } } }, [error, questionIds, confirm]);
  if (task.receipt) return <LearningEmpty title="alreadySubmitted" body="attemptRules" />;
  if (!task.questions.length) return <LearningEmpty title={task.window === "notOpen" ? "notOpen" : "attemptUnavailable"} body="noPublishedQuestions" />;
  const current = Math.max(0, Math.min(index, task.questions.length - 1)); const question = task.questions[current]; const answer = responses[question.id] ?? "";
  const answered = task.questions.filter(q => responses[q.id]?.trim()).length;
  async function save() {
    const result = await w.runLearning({ type: "saveAnswers", assessmentId: task.id, responses, revision });
    if (result?.draft) { baseline.current = JSON.stringify(result.draft.responses); setResponses(result.draft.responses); setRevision(result.draft.revision); w.setDirty(false); }
  }
  return <section className="panel learning-panel attempt-panel" aria-busy={busy}><h2>{label(locale, task)}</h2><p className="muted">{t("assessmentDemo")}</p><p className="banner">{t("answerDraft")}</p><p>{t("deadlineLabel")}: {date(locale, task.dueAt)} · {number(locale, task.maxMarks)} {t("marks")}</p>{!task.canAttempt && <p role="status" className="banner warning">{t("attemptUnavailable")}</p>}
    <p className="muted">{t("answeredCount")}: {number(locale, answered)} / {number(locale, task.questionCount)}</p>
    <nav className="question-summary" aria-label={t("questionSummary")}>{task.questions.map((q, i) => <button key={q.id} type="button" className={current === i ? "selected" : ""} aria-current={current === i ? "step" : undefined} aria-label={`${t("questionNumber")} ${number(locale, i + 1)} · ${t(responses[q.id]?.trim() ? "answered" : "unanswered")}`} onClick={() => setIndex(i)}>{number(locale, i + 1)} <span aria-hidden="true">{responses[q.id]?.trim() ? "✓" : "·"}</span></button>)}</nav>
    <fieldset className="answer-fieldset" disabled={busy || !task.canAttempt || !ready}><legend>{number(locale, current + 1)}. {label(locale, question)} <span className="muted">({number(locale, question.points)} {t("marks")})</span></legend>
      {question.type === "short" ? <textarea id={`answer-${question.id}`} aria-label={label(locale, question)} aria-invalid={error?.field === question.id} aria-describedby={error?.field === question.id ? "answer-error" : undefined} rows={7} maxLength={10000} value={answer} onChange={e => setResponses({ ...responses, [question.id]: e.target.value })} /> : <div id={`answer-${question.id}`} tabIndex={-1} role="radiogroup" aria-label={label(locale, question)}>{(question.type === "boolean" ? ["true", "false"] : question.choices).map(choice => <label className="answer-choice" key={choice}><input type="radio" name={question.id} checked={answer === choice} value={choice} onChange={() => setResponses({ ...responses, [question.id]: choice })} />{question.type === "boolean" ? t(choice) : choice}</label>)}</div>}
      {error?.field === question.id && <p className="field-error" role="alert" id="answer-error">{t(error.code)}</p>}
    </fieldset>
    <div className="actions question-navigation"><button className="button secondary" disabled={current <= 0} onClick={() => setIndex(current - 1)}>{t("previous")}</button><button className="button secondary" disabled={current >= task.questions.length - 1} onClick={() => setIndex(current + 1)}>{t("next")}</button></div>
    <div className="actions"><button className="button secondary" disabled={busy || !task.canAttempt || !ready} onClick={() => void save()}>{t(busy ? "working" : "saveAnswers")}</button><button className="button" disabled={busy || !task.canAttempt || !ready} onClick={() => setConfirm("submit")}>{t("finalSubmit")}</button>{task.draft && <button className="text-link" disabled={busy} onClick={() => setConfirm("load")}>{t("loadSavedDraft")}</button>}</div>
    <p className="muted">{t("attemptRules")}</p>
    {confirm && <Modal title={t(confirm === "submit" ? "confirmSubmission" : "loadSavedDraft")} busy={busy} close={() => setConfirm("")}><p>{t(confirm === "submit" ? "submissionWarning" : "discardHelp")}</p>{error && <p className="field-error" role="alert">{t(error.code)}</p>}<div className="dialog-actions"><button className="button secondary" disabled={busy} onClick={() => setConfirm("")}>{t("cancel")}</button><button className="button" disabled={busy} onClick={async () => {
      if (confirm === "load") { const next = task.draft?.responses ?? {}; setResponses(next); setRevision(task.draft?.revision ?? 0); baseline.current = JSON.stringify(next); w.setDirty(false); w.setError(undefined); setConfirm(""); return; }
      const result = await w.runLearning({ type: "submitAnswers", assessmentId: task.id, responses, revision });
      if (result?.record) { submitted.current = true; try { sessionStorage.removeItem(storageKey); } catch { /* Cache is not the final submission. */ } w.discardDraft(); setConfirm(""); w.navigate(`/student/submissions/${result.record.id}`, true); }
      else setConfirm("");
    }}>{t(busy ? "working" : "confirm")}</button></div></Modal>}
  </section>;
}
