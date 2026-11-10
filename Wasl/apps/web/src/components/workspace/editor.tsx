"use client";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { clone, get, schema } from "@wasl/shared/demo";
import type { DemoRecord, Kind, RecordInput } from "@wasl/shared/demo";
import { useWorkspace } from "./provider";
import { FormFields } from "./ui";

export function RecordEditor({ kind, row, role }: { kind: Kind; row?: DemoRecord; role: string }) {
  const w = useWorkspace(); const { data, session, t, run, busy, navigate } = w;
  const key = `${session.membershipId}:${kind}:${row?.id ?? "new"}`;
  const initial = (): RecordInput => {
    const person = kind === "memberships" && row && data ? get(data, "users", row.values.userId) : undefined;
    const values = Object.fromEntries(schema[kind].fields.map(f => [f.key, row?.values[f.key] ?? (f.key === "order" ? "1" : f.options?.[0] ?? "")]));
    if (person) values.email = person.values.email;
    return { name: person?.name ?? row?.name ?? "", nameAr: person?.nameAr ?? row?.nameAr ?? "", values };
  };
  const baseline = useRef(JSON.stringify(initial()));
  const [values, setValues] = useState<RecordInput>(() => clone(w.drafts.current[key] ?? initial()));
  useEffect(() => {
    w.draftKey.current = key; w.drafts.current[key] = values; w.setDirty(JSON.stringify(values) !== baseline.current);
    return () => w.setDirty(false);
  }, [key, values, w.draftKey, w.drafts, w.setDirty]);
  useEffect(() => { if (w.error?.field) document.getElementById(`field-${w.error.field}`)?.focus(); }, [w.error]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const result = await run({ type: "save", kind, id: row?.id, input: values });
    if (result?.record) { w.discardDraft(); navigate(`/${role}/${kind}/${result.record.id}`, true); }
  }
  return <form className="panel form-panel" noValidate onSubmit={submit} aria-busy={busy}><div className="section-heading"><h2>{t(row ? "edit" : "create")} · {t(kind)}</h2></div><FormFields kind={kind} row={row} values={values} set={setValues} /><div className="form-actions"><button className="button" type="submit" disabled={busy}>{t(busy ? "working" : "save")}</button><button type="button" className="button secondary" disabled={busy} onClick={() => navigate(`/${role}/${kind}${row ? `/${row.id}` : ""}`)}>{t("cancel")}</button></div></form>;
}
