import { useEffect, useRef, useState } from "react";
import { Alert, Linking, View } from "react-native";
import { canEdit, context, date, displayRecord, get, gradingValues, number, pageAllowed, questionRows, recordStatus, related, resultTotal, schema, totalMarks, transitions } from "../../../packages/shared/src/demo";
import type { Command, DemoRecord, Kind, RecordInput } from "../../../packages/shared/src/demo";
import { useNative } from "./context";
import { NativeRows } from "./records";
import { Badge, Button, Card, Field, styles, Txt } from "./ui";

function NativeGrading({ row }: { row: DemoRecord }) {
  const n = useNative(); const { data, t, locale, busy, run, ui, setUI } = n;
  const questions = data ? questionRows(data, row.values.assessmentId) : [];
  const key = `grading:${row.id}`;
  const initial = (): RecordInput => ({ name: "", nameAr: "", values: Object.fromEntries((data ? gradingValues(data, row) : []).flatMap(g => [[g.questionId, g.score], [`feedback:${g.questionId}`, g.feedback]])) });
  const [draft, setDraft] = useState(() => ui.forms[key] ?? initial()); const baseline = useRef(JSON.stringify(initial()));
  useEffect(() => { n.activeDraftKey.current = key; setUI(old => ({ ...old, forms: { ...old.forms, [key]: draft } })); n.setDirty(JSON.stringify(draft) !== baseline.current); return () => n.setDirty(false); }, [draft, key, setUI, n.setDirty]);
  if (!data) return null;
  return <Card><Txt title>{t("grade")}</Txt><Txt muted>{t("gradedHelp")}</Txt>{questions.map(q => {
    const answer = data.records.answers.find(a => a.values.submissionId === row.id && a.values.questionId === q.id);
    return <View key={q.id}><View style={styles.divider} /><Txt style={{ fontWeight: "700" }}>{displayRecord(data, "questions", q, locale === "ar")} · {number(locale, Number(q.values.points))} {t("marks")}</Txt><Txt>{t("response")}: {t(answer?.values.response || "optional")}</Txt>{answer?.values.filename && <Txt muted>{answer.values.filename} · {t("attachmentNotice")}</Txt>}<Txt muted>{t("correct")}: {t(q.values.correct)}</Txt><Field label={t("marks")} keyboardType="decimal-pad" value={draft.values[q.id]} onChangeText={v => setDraft({ ...draft, values: { ...draft.values, [q.id]: v } })} error={n.error?.field === q.id ? t(n.error.code) : undefined} /><Field label={t("feedback")} value={draft.values[`feedback:${q.id}`]} multiline onChangeText={v => setDraft({ ...draft, values: { ...draft.values, [`feedback:${q.id}`]: v } })} /></View>;
  })}<Button disabled={busy} onPress={async () => { if (await run({ type: "grade", id: row.id, scores: questions.map(q => ({ questionId: q.id, score: draft.values[q.id], feedback: draft.values[`feedback:${q.id}`] })) })) { baseline.current = JSON.stringify(draft); n.setDirty(false); setUI(old => { const forms = { ...old.forms }; delete forms[key]; return { ...old, forms }; }); } }}>{t(busy ? "working" : "saveGrading")}</Button></Card>;
}
export function NativeDetail({ kind, row }: { kind: Kind; row: DemoRecord }) {
  const n = useNative(); const { data, session, t, locale, go, busy, run } = n; if (!data) return null;
  const panels = related(data, session, kind, row).filter(p => pageAllowed(data, session, p.kind));
  return <View><Card><Txt title>{displayRecord(data, kind, row, locale === "ar")}</Txt><Badge value={recordStatus(kind, row)} /><Txt muted ltr>{row.id}</Txt>{schema[kind].fields.map(f => {
    const v = kind === "memberships" && f.key === "email" ? get(data, "users", row.values.userId)?.values.email ?? "" : row.values[f.key]; const target = f.ref && get(data, f.ref, v);
    return <View key={f.key}><Txt muted>{t(f.key)}</Txt>{f.key === "url" && v ? <Button secondary onPress={() => { void Linking.openURL(v).catch(() => n.setError({ code: "invalidUrl" })); }}>{t("view")}</Button> : <Txt ltr={["email", "filename"].includes(f.key)}>{target ? displayRecord(data, f.ref!, target, locale === "ar") : f.type === "date" ? date(locale, v) : f.type === "number" ? number(locale, Number(v)) : t(v || "optional")}</Txt>}</View>;
  })}{kind === "assessments" && <Txt>{t("questions")}: {number(locale, questionRows(data, row.id).length)} · {t("marks")}: {number(locale, totalMarks(data, row.id))}</Txt>}{kind === "submissions" && <Txt>{t("total")}: {resultTotal(data, row.id) === undefined ? t("noGrade") : `${number(locale, resultTotal(data, row.id)!)} / ${number(locale, totalMarks(data, row.values.assessmentId))}`}</Txt>}{(kind === "resources" && row.values.type === "file" || kind === "answers" && row.values.filename) && <Txt muted>{t("attachmentNotice")}</Txt>}{canEdit(data, session, kind, row) && <Button secondary onPress={() => go({ page: kind, id: row.id, edit: true })}>{t("edit")}</Button>}{transitions(data, session, kind, row).map(verb => <Button key={verb} secondary disabled={busy} onPress={() => {
    const action = () => { void run({ type: "transition", kind, id: row.id, verb: verb as Extract<Command, { type: "transition" }>["verb"] }); };
    if (verb === "read" || verb === "unread") action(); else Alert.alert(t(verb), t("confirmChange"), [{ text: t("cancel"), style: "cancel" }, { text: t("confirm"), onPress: action }]);
  }}>{t(verb === "read" ? "markRead" : verb === "unread" ? "markUnread" : verb)}</Button>)}{kind === "notifications" && row.values.targetKind && <Button secondary onPress={() => go({ page: row.values.targetKind, id: row.values.targetId })}>{t("destination")}</Button>}</Card>
  {kind === "assessments" && row.values.status === "draft" && <Button onPress={() => go({ page: "assessmentQuestions", id: "new" })}>{t("create")} · {t("assessmentQuestions")}</Button>}
  {kind === "submissions" && row.values.status !== "released" && !context(data, session).admin && <NativeGrading key={row.id} row={row} />}
  {panels.map(p => <NativeRows key={p.kind} kind={p.kind} rows={p.rows} title={p.title ?? p.kind} />)}</View>;
}
