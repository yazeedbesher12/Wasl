"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { displayRecord, number, options, schema } from "@wasl/shared/demo";
import type { DemoRecord, Field, Kind, RecordInput } from "@wasl/shared/demo";
import { useWorkspace } from "./provider";
import { EducationArt } from "../education";

export function Modal({ title, children, close, busy = false, className = "" }: { title: string; children: ReactNode; close: () => void; busy?: boolean; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null); const id = useId(); const { t } = useWorkspace();
  useEffect(() => { const target = document.activeElement; const dialog = ref.current; dialog?.showModal(); return () => { dialog?.close(); if (target instanceof HTMLElement && target.isConnected) target.focus(); else document.getElementById("workspace-main")?.focus(); }; }, []);
  return <dialog ref={ref} className={className} aria-labelledby={id} onCancel={e => { e.preventDefault(); if (!busy) close(); }}><div className="dialog-heading"><h2 id={id}>{title}</h2><button className="icon-button" type="button" disabled={busy} aria-label={t("close")} onClick={close}>×</button></div>{children}</dialog>;
}
export function Language() { const { locale, setLocale } = useWorkspace(); return <div className="language-switch" role="group" aria-label="عربي / English"><button type="button" lang="ar" aria-pressed={locale === "ar"} onClick={() => setLocale("ar")}>عربي</button><button type="button" lang="en" aria-pressed={locale === "en"} onClick={() => setLocale("en")}>English</button></div>; }
export function Badge({ value }: { value: string }) { const { t } = useWorkspace(); return <span className={`badge ${["active", "published", "approved", "released"].includes(value) ? "positive" : ["inactive", "closed", "revoked"].includes(value) ? "warning" : "neutral"}`}>{t(value)}</span>; }
export function Feedback() { const { error, success, t, persistent } = useWorkspace(); return <>{!persistent && <p className="banner warning" role="status">{t("storageError")}</p>}{error && <p className="form-alert workspace-alert" role="alert">{t(error.code)}</p>}{success && <p className="banner" role="status">{t(success)}</p>}</>; }
export function Blank({ filtered = false }: { filtered?: boolean }) { const { t } = useWorkspace(); return <div className="empty"><EducationArt subject="" className="empty-illustration" /><h2>{t(filtered ? "noMatches" : "empty")}</h2>{!filtered && <p className="muted">{t("emptyHelp")}</p>}</div>; }
export function Pager({ current, total, change }: { current: number; total: number; change: (n: number) => void }) { const { t, locale } = useWorkspace(); return <div className="pagination"><span>{t("page")} {number(locale, current)} {t("of")} {number(locale, total)}</span><div className="actions"><button className="button secondary" disabled={current <= 1} onClick={() => change(current - 1)}>{t("previous")}</button><button className="button secondary" disabled={current >= total} onClick={() => change(current + 1)}>{t("next")}</button></div></div>; }
export function ReferenceSelect({ field, kind, value, set }: { field: Field; kind: Kind; value: string; set: (v: string) => void }) {
  const { data, session, locale, t, error } = useWorkspace(); const [query, setQuery] = useState("");
  if (!data) return null;
  const rows = options(data, session, kind, field.key);
  const selected = rows.find(r => r.id === value);
  const matches = rows.filter(r => `${displayRecord(data, field.ref!, r, false)} ${displayRecord(data, field.ref!, r, true)} ${r.values.email ?? ""}`.toLowerCase().includes(query.toLowerCase())).slice(0, 80);
  const shown = selected && !matches.some(r => r.id === value) ? [selected, ...matches] : matches;
  return <div className="reference-select">{rows.length > 30 && <input type="search" value={query} aria-label={`${t("search")} · ${t(field.key)}`} onChange={e => setQuery(e.target.value)} />}<select id={`field-${field.key}`} aria-label={t(field.key)} aria-invalid={error?.field === field.key} aria-describedby={error?.field === field.key ? `field-error-${field.key}` : undefined} value={value} onChange={e => set(e.target.value)} required={!field.optional}><option value="">{t(field.optional ? "optional" : "select")}</option>{shown.map(r => <option key={r.id} value={r.id}>{displayRecord(data, field.ref!, r, locale === "ar")} {r.values.email ? `· ${r.values.email}` : ""}</option>)}</select></div>;
}
export function FormFields({ kind, values, set, row }: { kind: Kind; values: RecordInput; set: (next: RecordInput) => void; row?: DemoRecord }) {
  const { data, t, error, busy } = useWorkspace();
  const fields: Field[] = [...(schema[kind].named ? [{ key: "name" }, { key: "nameAr" }] : []), ...schema[kind].fields];
  function change(key: string, value: string) {
    if (key === "name" || key === "nameAr") set({ ...values, [key]: value });
    else {
      const person = kind === "memberships" && key === "userId" ? data?.records.users.find(u => u.id === value) : undefined;
      set({ ...values, ...(person ? { name: person.name, nameAr: person.nameAr } : {}), values: { ...values.values, [key]: value, ...(person ? { email: person.values.email } : {}) } });
    }
  }
  return <fieldset disabled={busy} className="form-grid workspace-fields">{kind === "memberships" && <p className="muted full-width">{t("reuseHelp")}</p>}{fields.map(f => {
    const value = f.key === "name" || f.key === "nameAr" ? values[f.key] : values.values[f.key] ?? "";
    const errorId = `field-error-${f.key}`;
    return <label key={f.key}>{t(f.key)}{f.optional && <small>{t("optional")}</small>}{f.ref ? <ReferenceSelect field={f} kind={kind} value={value} set={v => change(f.key, v)} /> : f.options ? <select id={`field-${f.key}`} value={value} aria-invalid={error?.field === f.key} aria-describedby={error?.field === f.key ? errorId : undefined} onChange={e => change(f.key, e.target.value)} required={!f.optional}><option value="">{t("select")}</option>{f.options.map(o => <option value={o} key={o}>{t(o)}</option>)}</select> : f.type === "long" ? <textarea id={`field-${f.key}`} value={value} rows={5} required={!f.optional} onChange={e => change(f.key, e.target.value)} aria-invalid={error?.field === f.key} aria-describedby={error?.field === f.key ? errorId : undefined} /> : <input id={`field-${f.key}`} value={value} type={f.type === "number" ? "number" : f.type === "email" ? "email" : "text"} dir={["name", "email", "url", "filename", "startDate", "endDate", "opensAt", "dueAt", "code"].includes(f.key) ? "ltr" : f.key === "nameAr" ? "rtl" : undefined} step={f.key === "points" ? "any" : "1"} min={0} maxLength={f.type === "number" ? undefined : 600} required={!f.optional && !(kind === "memberships" && values.values.userId && ["name", "nameAr"].includes(f.key))} onChange={e => change(f.key, e.target.value)} aria-invalid={error?.field === f.key} aria-describedby={error?.field === f.key ? errorId : undefined} />}{error?.field === f.key && <span className="field-error" id={errorId}>{t(error.code)}</span>}</label>;
  })}{kind === "resources" && <p className="muted full-width">{t("attachmentNotice")}</p>}{row && <input type="hidden" value={row.id} readOnly />}</fieldset>;
}
