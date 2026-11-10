"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { useAdmin } from "@/components/admin/provider";
import { Dialog, Heading, LanguageSwitch } from "@/components/admin/ui";
import type { DemoState } from "@/lib/admin/model";
import type { Message } from "@/lib/admin/i18n";

function AdministratorForm({ initial }: { initial: DemoState["administrator"] }) {
  const { t, busy, saveAdministrator } = useAdmin();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof typeof initial, Message>>>({});
  const submitting = useRef(false);
  const fields = ["name", "nameAr", "email"] as const;
  const labels = { name: "displayName", nameAr: "displayNameAr", email: "email" } as const;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || submitting.current) return;
    const next: typeof errors = {};
    for (const field of fields) if (!values[field].trim()) next[field] = "required";
    if (values.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) next.email = "invalidEmail";
    setErrors(next);
    if (Object.values(next).some(Boolean)) { document.getElementById(`admin-${fields.find(f => next[f])}`)?.focus(); return; }
    submitting.current = true;
    await saveAdministrator({ name: values.name.trim(), nameAr: values.nameAr.trim(), email: values.email.trim() });
    submitting.current = false;
  }
  return <form className="settings-section" noValidate onSubmit={submit} aria-busy={busy}><div><h2>{t("displayInfo")}</h2><p className="muted">{t("displayInfoHelp")}</p></div><div className="settings-fields">{fields.map(field => <label key={field} htmlFor={`admin-${field}`}>{t(labels[field])}<input id={`admin-${field}`} value={values[field]} required maxLength={field === "email" ? 254 : 100} disabled={busy} dir={field === "nameAr" ? "rtl" : "ltr"} type={field === "email" ? "email" : "text"} aria-invalid={!!errors[field]} aria-describedby={errors[field] ? `admin-error-${field}` : undefined} onChange={e => { setValues({ ...values, [field]: e.target.value }); setErrors(prev => ({ ...prev, [field]: undefined })); }} />{errors[field] && <span className="field-error" id={`admin-error-${field}`}>{t(errors[field])}</span>}</label>)}<button type="submit" className="button" disabled={busy}>{t(busy ? "saving" : "save")}</button></div></form>;
}
export default function SettingsPage() {
  const { data, t, busy, reset } = useAdmin();
  const [confirm, setConfirm] = useState(false);
  const [generation, setGeneration] = useState(0);
  if (!data) return null;
  return <><Heading title={t("settings")} intro={t("settingsIntro")} /><section className="panel settings-panel"><div className="settings-section"><div><h2>{t("language")}</h2><p className="muted">{t("languageHelp")}</p></div><LanguageSwitch /></div>
    <AdministratorForm key={generation} initial={data.administrator} />
    <div className="settings-section reset-section"><div><h2>{t("reset")}</h2><p className="muted">{t("resetHelp")}</p></div><button className="button danger-outline" disabled={busy} onClick={() => setConfirm(true)}>{t("reset")}</button></div></section>
    {confirm && <Dialog title={t("resetTitle")} busy={busy} onClose={() => setConfirm(false)}><p className="muted">{t("resetBody")}</p><div className="dialog-actions"><button className="button secondary" disabled={busy} onClick={() => setConfirm(false)}>{t("cancel")}</button><button className="button danger" disabled={busy} onClick={async () => { if (await reset()) { setGeneration(g => g + 1); setConfirm(false); } }}>{t(busy ? "working" : "reset")}</button></div></Dialog>}
  </>;
}
