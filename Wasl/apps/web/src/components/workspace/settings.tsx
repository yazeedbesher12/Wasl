"use client";
import { useEffect, useRef, useState } from "react";
import { context } from "@wasl/shared/demo";
import { useWorkspace } from "./provider";

export function SchoolSettings() {
  const w = useWorkspace(); const { data, session, t, busy, run } = w;
  const school = data ? context(data, session).school : undefined;
  const initial = { name: school?.name ?? "", nameAr: school?.nameAr ?? "", city: school?.demo.city ?? "", cityAr: school?.demo.cityAr ?? "", locale: school?.locale ?? "ar" };
  const key = `settings:${school?.id}`;
  const [values, setValues] = useState<Record<string, string>>(() => w.drafts.current[key]?.values ?? initial);
  const baseline = useRef(JSON.stringify(initial));
  useEffect(() => { w.draftKey.current = key; w.drafts.current[key] = { name: "", nameAr: "", values }; w.setDirty(JSON.stringify(values) !== baseline.current); return () => w.setDirty(false); }, [values, key, w.draftKey, w.drafts, w.setDirty]);
  return <form className="panel form-panel" noValidate onSubmit={async e => { e.preventDefault(); if (await run({ type: "schoolProfile", input: values })) { baseline.current = JSON.stringify(values); w.setDirty(false); } }}><div className="section-heading"><h2>{t("settings")}</h2></div><p className="form-help muted">{t("settingsHelp")}</p><fieldset disabled={busy} className="form-grid workspace-fields">{(["name", "nameAr", "city", "cityAr"] as const).map(key => <label key={key}>{t(key)}<input dir={key.endsWith("Ar") ? "rtl" : "ltr"} required value={values[key]} onChange={e => setValues({ ...values, [key]: e.target.value })} aria-invalid={w.error?.field === key} />{w.error?.field === key && <span className="field-error">{t(w.error.code)}</span>}</label>)}<label>{t("locale")}<select value={values.locale} onChange={e => setValues({ ...values, locale: e.target.value as "ar" | "en" })}><option value="ar">العربية</option><option value="en">English</option></select></label></fieldset><div className="form-actions"><button className="button" disabled={busy}>{t(busy ? "working" : "save")}</button></div></form>;
}
