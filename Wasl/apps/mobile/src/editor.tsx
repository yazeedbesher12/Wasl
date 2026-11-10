import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { clone, displayRecord, get, options, schema } from "../../../packages/shared/src/demo";
import type { DemoRecord, Field as FieldSpec, Kind, RecordInput } from "../../../packages/shared/src/demo";
import { useNative } from "./context";
import { Button, Card, Field, Select, Txt } from "./ui";

export function NativeEditor({ kind, row }: { kind: Kind; row?: DemoRecord }) {
  const n = useNative(); const { data, session, locale, t, busy, run, ui, setUI } = n;
  function initial(): RecordInput {
    const person = kind === "memberships" && row && data ? get(data, "users", row.values.userId) : undefined;
    const values = Object.fromEntries(schema[kind].fields.map(f => [f.key, row?.values[f.key] ?? (f.key === "order" ? "1" : f.options?.[0] ?? "")]));
    if (person) values.email = person.values.email;
    return { name: person?.name ?? row?.name ?? "", nameAr: person?.nameAr ?? row?.nameAr ?? "", values };
  }
  const key = `${session.membershipId}:${kind}:${row?.id ?? "new"}`;
  const [values, setValues] = useState<RecordInput>(() => clone(ui.forms[key] ?? initial()));
  const baseline = useRef(JSON.stringify(initial()));
  useEffect(() => { n.activeDraftKey.current = key; setUI(old => ({ ...old, forms: { ...old.forms, [key]: values } })); n.setDirty(JSON.stringify(values) !== baseline.current); return () => n.setDirty(false); }, [values, key, setUI, n.setDirty]);
  if (!data) return null;
  const fields: FieldSpec[] = [...(schema[kind].named ? [{ key: "name" }, { key: "nameAr" }] : []), ...schema[kind].fields];
  function change(key: string, value: string) {
    if (key === "name" || key === "nameAr") setValues({ ...values, [key]: value });
    else { const person = kind === "memberships" && key === "userId" ? data?.records.users.find(p => p.id === value) : undefined;
      setValues({ ...values, ...(person ? { name: person.name, nameAr: person.nameAr } : {}), values: { ...values.values, [key]: value, ...(person ? { email: person.values.email } : {}) } }); }
  }
  return <Card><Txt title>{t(row ? "edit" : "create")} · {t(kind)}</Txt>{kind === "memberships" && <Txt muted>{t("reuseHelp")}</Txt>}{fields.map(f => {
    const value = f.key === "name" || f.key === "nameAr" ? values[f.key] : values.values[f.key] ?? "";
    const label = `${t(f.key)}${f.optional ? ` · ${t("optional")}` : " *"}`;
    return <View key={f.key}>{f.ref ? <Select label={label} value={value} optional={f.optional} options={options(data, session, kind, f.key).map(r => ({ value: r.id, label: `${displayRecord(data, f.ref!, r, locale === "ar")} / ${displayRecord(data, f.ref!, r, locale !== "ar")}${r.values.email ? ` · ${r.values.email}` : ""}` }))} onChange={v => change(f.key, v)} /> : f.options ? <Select label={label} value={value} options={f.options.map(v => ({ value: v, label: t(v) }))} onChange={v => change(f.key, v)} /> : <Field label={label} value={value} onChangeText={v => change(f.key, v)} multiline={f.type === "long"} keyboardType={f.type === "number" ? "decimal-pad" : f.type === "email" ? "email-address" : "default"} autoCapitalize={f.type === "email" || f.key === "url" ? "none" : "sentences"} style={["email", "url", "filename", "name", "code", "startDate", "endDate", "opensAt", "dueAt"].includes(f.key) ? { textAlign: "left", writingDirection: "ltr" } : f.key === "nameAr" ? { textAlign: "right", writingDirection: "rtl" } : undefined} error={n.error?.field === f.key ? t(n.error.code) : undefined} />}{f.ref && n.error?.field === f.key && <Txt accessibilityRole="alert" style={{ color: "#B33838" }}>{t(n.error.code)}</Txt>}</View>;
  })}{kind === "resources" && <Txt muted>{t("attachmentNotice")}</Txt>}<Button disabled={busy} onPress={async () => { const result = await run({ type: "save", kind, id: row?.id, input: values }); if (result?.record) { setUI(old => { const forms = { ...old.forms }; delete forms[key]; return { ...old, forms }; }); n.setDirty(false); n.go({ page: kind, id: result.record.id }, true); } }}>{t(busy ? "working" : "save")}</Button><Button secondary disabled={busy} onPress={() => n.back()}>{t("cancel")}</Button></Card>;
}
