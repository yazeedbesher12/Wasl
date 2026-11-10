import { useState } from "react";
import { View } from "react-native";
import { date, displayRecord, filtered, get, number, recordStatus, resultTotal, schema, totalMarks, visible } from "../../../packages/shared/src/demo";
import type { DemoRecord, Kind } from "../../../packages/shared/src/demo";
import { useNative } from "./context";
import { artStyles, NativeEducationArt } from "./education";
import { Badge, Blank, Button, Card, Field, Select, styles, Txt } from "./ui";

export function NativeRows({ kind, rows, title }: { kind: Kind; rows: DemoRecord[]; title?: string }) {
  const { data, locale, t, go } = useNative(); const [page, setPage] = useState(1);
  if (!data) return null;
  const pages = Math.max(1, Math.ceil(rows.length / 10)); const current = Math.min(page, pages);
  if (!rows.length) return <Blank />;
  return <View>{title && <Txt style={styles.sectionTitle}>{t(title)}</Txt>}{rows.slice((current - 1) * 10, current * 10).map(row => <Card key={row.id} accent={kind === "announcements"}>{kind === "assignments" && <View style={artStyles.classArt}><NativeEducationArt subject={`${get(data, "subjects", row.values.subjectId)?.name} ${get(data, "subjects", row.values.subjectId)?.nameAr}`} width={120} /></View>}<Txt style={{ fontWeight: "700" }}>{displayRecord(data, kind, row, locale === "ar")}</Txt><Badge value={recordStatus(kind, row)} />{schema[kind].fields.filter(f => !["body", "correct", "choices", "instructions"].includes(f.key)).slice(0, 3).map(f => {
    const v = kind === "memberships" && f.key === "email" ? get(data, "users", row.values.userId)?.values.email ?? "" : row.values[f.key]; const ref = f.ref && get(data, f.ref, v);
    return <Txt muted key={f.key} ltr={f.key === "email"}>{t(f.key)}: {ref ? displayRecord(data, f.ref!, ref, locale === "ar") : f.type === "date" ? date(locale, v) : f.type === "number" ? number(locale, Number(v)) : t(v || "optional")}</Txt>;
  })}{kind === "submissions" && <Txt>{t("total")}: {resultTotal(data, row.id) === undefined ? t("noGrade") : `${number(locale, resultTotal(data, row.id)!)} / ${number(locale, totalMarks(data, row.values.assessmentId))}`}</Txt>}<Button secondary onPress={() => go({ page: kind, id: row.id })}>{t("view")}</Button></Card>)}{pages > 1 && <View style={styles.row}><Button secondary disabled={current <= 1} onPress={() => setPage(current - 1)}>{t("previous")}</Button><Txt muted>{number(locale, current)} {t("of")} {number(locale, pages)}</Txt><Button secondary disabled={current >= pages} onPress={() => setPage(current + 1)}>{t("next")}</Button></View>}</View>;
}
export function NativeList({ kind }: { kind: Kind }) {
  const { data, session, locale, t, ui, setUI } = useNative();
  const [query, status, classFilter, roleFilter, assessmentFilter] = ui.filters[kind] ?? ["", "", "", "", ""];
  if (!data) return null;
  const all = visible(data, session, kind); const rows = filtered(data, session, kind, locale, query, status, classFilter, roleFilter, assessmentFilter);
  const set = (idx: number, value: string) => setUI(old => { const values = [...(old.filters[kind] ?? ["", "", "", "", ""])]; values[idx] = value; return { ...old, filters: { ...old.filters, [kind]: values } }; });
  return <View><Card><Field label={t("search")} value={query} onChangeText={v => set(0, v)} /><Select label={t("status")} value={status} optional options={[...new Set(all.map(r => recordStatus(kind, r)))].map(v => ({ value: v, label: t(v) }))} onChange={v => set(1, v)} />{kind === "memberships" && <Select label={t("role")} value={roleFilter} optional options={["SCHOOL_ADMIN", "TEACHER", "STUDENT", "PARENT"].map(r => ({ value: r, label: t(r) }))} onChange={v => set(3, v)} />}{!["assignments", "users", "memberships", "notifications", "enrollments", "years", "semesters", "grades", "sections", "subjects", "links", "preferences"].includes(kind) && <Select label={t("filterClass")} value={classFilter} optional options={visible(data, session, "assignments").map(a => ({ value: a.id, label: displayRecord(data, "assignments", a, locale === "ar") }))} onChange={v => set(2, v)} />}{kind === "submissions" && <Select label={t("assessmentId")} value={assessmentFilter} optional options={visible(data, session, "assessments").map(a => ({ value: a.id, label: displayRecord(data, "assessments", a, locale === "ar") }))} onChange={v => set(4, v)} />}<Button secondary onPress={() => setUI(old => ({ ...old, filters: { ...old.filters, [kind]: ["", "", "", "", ""] } }))}>{t("resetFilters")}</Button><Txt muted accessibilityLiveRegion="polite">{number(locale, rows.length)} {t("results")}</Txt></Card>{rows.length ? <NativeRows key={`${kind}:${query}:${status}:${classFilter}:${roleFilter}:${assessmentFilter}`} kind={kind} rows={rows} /> : <Blank filtered={all.length > 0} />}</View>;
}
