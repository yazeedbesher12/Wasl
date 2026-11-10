"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { School, SchoolInput } from "@/lib/admin/model";
import type { Message } from "@/lib/admin/i18n";
import { useAdmin } from "./provider";
import { Dialog, Heading, Status } from "./ui";
import { MissingSchool } from "./school-detail";

const fields = ["name", "nameAr", "city", "cityAr", "administrator", "administratorAr", "email"] as const;
type Field = typeof fields[number];
function initial(school?: School): SchoolInput {
  return { name: school?.name ?? "", nameAr: school?.nameAr ?? "", locale: school?.locale ?? "ar", active: school?.active ?? true,
    city: school?.demo.city ?? "", cityAr: school?.demo.cityAr ?? "", administrator: school?.demo.administrator ?? "", administratorAr: school?.demo.administratorAr ?? "", email: school?.demo.email ?? "" };
}
function Editor({ school }: { school?: School }) {
  const { t, busy, saveSchool } = useAdmin();
  const router = useRouter();
  const [values, setValues] = useState<SchoolInput>(() => initial(school));
  const [errors, setErrors] = useState<Partial<Record<Field, Message>>>({});
  const [discard, setDiscard] = useState(false);
  const submitting = useRef(false);
  const baseline = useRef(JSON.stringify(initial(school)));
  const dirty = JSON.stringify(values) !== baseline.current;
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const destination = school ? `/admin/schools/${school.id}` : "/admin/schools";
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting.current || busy) return;
    const nextErrors: Partial<Record<Field, Message>> = {};
    for (const field of fields) if (!values[field].trim()) nextErrors[field] = "required";
    if (values.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) nextErrors.email = "invalidEmail";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      const first = fields.find(f => nextErrors[f]);
      if (first) document.getElementById(`school-${first}`)?.focus();
      return;
    }
    submitting.current = true;
    const result = await saveSchool({ ...values, email: values.email.trim() }, school?.id);
    if (result) {
      baseline.current = JSON.stringify(values);
      router.push(`/admin/schools/${result.school.id}`);
      // Keep the submission guard until this route unmounts.
      return;
    }
    submitting.current = false;
  }
  return <><Heading title={t(school ? "editSchool" : "add")} intro={t(school ? "editIntro" : "addIntro")} />
    <form className="panel form-panel" noValidate onSubmit={submit} aria-busy={busy}><div className="section-heading"><h2>{t("profile")}</h2><span className="muted">{t(dirty ? "unsaved" : "fieldsRequired")}</span></div>
      {Object.values(errors).some(Boolean) && <p className="form-alert" role="alert">{t("fixErrors")}</p>}
      <div className="form-grid">{fields.map(field => <label key={field} htmlFor={`school-${field}`}>{t(field)}<input id={`school-${field}`} name={field} value={values[field]} type={field === "email" ? "email" : "text"} dir={field.endsWith("Ar") ? "rtl" : "ltr"} autoComplete={field === "email" ? "email" : "off"} required maxLength={field === "email" ? 254 : 160} disabled={busy} aria-invalid={!!errors[field]} aria-describedby={errors[field] ? `error-${field}` : undefined} onChange={e => { setValues({ ...values, [field]: e.target.value }); setErrors(prev => ({ ...prev, [field]: undefined })); }} />{errors[field] && <span className="field-error" id={`error-${field}`}>{t(errors[field])}</span>}</label>)}
      <label>{t("schoolLocale")}<select value={values.locale} disabled={busy} onChange={e => setValues({ ...values, locale: e.target.value as SchoolInput["locale"] })}><option value="ar">العربية</option><option value="en">English</option></select></label>
      </div>
      <div className="form-status"><span>{t("status")}</span><Status active={values.active} /></div>
      {school && <p className="muted form-help">{t("accessHelp")}</p>}
      <div className="form-actions"><button className="button" type="submit" disabled={busy}>{t(busy ? "saving" : school ? "save" : "create")}</button><button className="button secondary" type="button" disabled={busy} onClick={() => dirty ? setDiscard(true) : router.push(destination)}>{t("cancel")}</button></div>
    </form>
    {discard && <Dialog title={t("discardTitle")} onClose={() => setDiscard(false)}><p className="muted">{t("discardBody")}</p><div className="dialog-actions"><button className="button secondary" onClick={() => setDiscard(false)}>{t("cancel")}</button><button className="button danger" onClick={() => router.push(destination)}>{t("discard")}</button></div></Dialog>}
  </>;
}
export function SchoolForm({ id }: { id?: string }) {
  const { data } = useAdmin();
  if (!data) return null;
  const school = id ? data.schools.find(s => s.id === id) : undefined;
  if (id && !school) return <MissingSchool />;
  return <Editor key={id ?? "new"} school={school} />;
}
