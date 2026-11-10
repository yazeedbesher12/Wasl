import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { date, label, number, tokens } from "../../../../packages/shared/src/demo";
import type { RecordInput, TaskView } from "../../../../packages/shared/src/demo";
import { useNative } from "../context";
import { Button, Card, Field, styles, Txt } from "../ui";
import { NativeLearningEmpty } from "./content";

export function NativeAssessmentAttempt({ task }: { task: TaskView }) {
  const n = useNative(); const { t, locale, session, busy, ui, setUI, runLearning } = n;
  const key = `attempt:${session.membershipId}:${task.id}`;
  const questionIds = task.questions.map(q => q.id).join("|");
  const saved = ui.forms[key];
  const [responses, setResponses] = useState<Record<string, string>>(() => saved?.values ?? task.draft?.responses ?? {});
  const [revision, setRevision] = useState(() => saved && Number.isInteger(Number(saved.nameAr)) ? Number(saved.nameAr) : task.draft?.revision ?? 0);
  const [index, setIndex] = useState(() => saved && Number.isInteger(Number(saved.name)) ? Number(saved.name) : 0);
  const baseline = useRef(JSON.stringify(task.draft?.responses ?? {})); const submitted = useRef(false);
  useEffect(() => {
    if (submitted.current) return;
    const draft: RecordInput = { name: String(index), nameAr: String(revision), values: responses };
    n.activeDraftKey.current = key; setUI(old => ({ ...old, forms: { ...old.forms, [key]: draft } })); n.setDirty(JSON.stringify(responses) !== baseline.current);
    return () => n.setDirty(false);
  }, [responses, revision, index, key, setUI, n.setDirty, n.activeDraftKey]);
  useEffect(() => { if (n.error?.field) { const i = questionIds.split("|").indexOf(n.error.field); if (i >= 0) setIndex(i); } }, [n.error, questionIds]);
  if (task.receipt) return <NativeLearningEmpty title="alreadySubmitted" body="attemptRules" />;
  if (!task.questions.length) return <NativeLearningEmpty title={task.window === "notOpen" ? "notOpen" : "attemptUnavailable"} body="noPublishedQuestions" />;
  const current = Math.max(0, Math.min(index, task.questions.length - 1)); const q = task.questions[current]; const answer = responses[q.id] ?? "";
  const answered = task.questions.filter(q => responses[q.id]?.trim()).length;
  return <View><Card><Txt title>{label(locale, task)}</Txt><Txt muted>{t("assessmentDemo")}</Txt><Txt>{t("answerDraft")}</Txt><Txt muted>{t("deadlineLabel")}: {date(locale, task.dueAt)}</Txt><Txt>{t("answeredCount")}: {number(locale, answered)} / {number(locale, task.questionCount)}</Txt>{!task.canAttempt && <Txt accessibilityLiveRegion="polite">{t("attemptUnavailable")}</Txt>}<Txt muted>{t("questionSummary")}</Txt><View style={styles.row}>{task.questions.map((question, i) => <Pressable key={question.id} accessibilityRole="button" accessibilityLabel={`${t("questionNumber")} ${number(locale, i + 1)} · ${t(responses[question.id]?.trim() ? "answered" : "unanswered")}`} accessibilityState={{ selected: current === i }} style={[styles.button, { backgroundColor: current === i ? tokens.primary : tokens.tint, minWidth: 48 }]} onPress={() => setIndex(i)}><Txt style={{ color: current === i ? "white" : tokens.primary }}>{number(locale, i + 1)} {responses[question.id]?.trim() ? "✓" : "·"}</Txt></Pressable>)}</View></Card>
    <Card><Txt title>{number(locale, current + 1)}. {label(locale, q)}</Txt><Txt muted>{number(locale, q.points)} {t("marks")}</Txt>
      {q.type === "short" ? <Field label={t("response")} value={answer} multiline maxLength={10000} editable={task.canAttempt && !busy} onChangeText={value => setResponses({ ...responses, [q.id]: value })} error={n.error?.field === q.id ? t(n.error.code) : undefined} /> : <View accessibilityRole="radiogroup" accessibilityLabel={label(locale, q)} style={{ gap: 10 }}>{(q.type === "boolean" ? ["true", "false"] : q.choices).map(choice => <Pressable key={choice} accessibilityRole="radio" accessibilityState={{ checked: answer === choice, disabled: busy || !task.canAttempt }} disabled={busy || !task.canAttempt} onPress={() => setResponses({ ...responses, [q.id]: choice })} style={[styles.input, answer === choice && { borderColor: tokens.primary, backgroundColor: tokens.tint }]}><Txt>{answer === choice ? "◉ " : "○ "}{q.type === "boolean" ? t(choice) : choice}</Txt></Pressable>)}</View>}
      {q.type !== "short" && n.error?.field === q.id && <Txt accessibilityRole="alert" style={{ color: tokens.red }}>{t(n.error.code)}</Txt>}
      <View style={styles.row}><Button secondary disabled={current <= 0} onPress={() => setIndex(current - 1)}>{t("previous")}</Button><Button secondary disabled={current >= task.questions.length - 1} onPress={() => setIndex(current + 1)}>{t("next")}</Button></View>
    </Card>
    <Card><Button secondary disabled={busy || !task.canAttempt} onPress={async () => { const result = await runLearning({ type: "saveAnswers", assessmentId: task.id, responses, revision }); if (result?.draft) { baseline.current = JSON.stringify(result.draft.responses); setResponses(result.draft.responses); setRevision(result.draft.revision); n.setDirty(false); } }}>{t(busy ? "working" : "saveAnswers")}</Button><Button disabled={busy || !task.canAttempt} onPress={() => Alert.alert(t("confirmSubmission"), t("submissionWarning"), [{ text: t("cancel"), style: "cancel" }, { text: t("confirm"), onPress: () => { void (async () => {
      const result = await runLearning({ type: "submitAnswers", assessmentId: task.id, responses, revision });
      if (result?.record) { submitted.current = true; n.setDirty(false); setUI(old => { const forms = { ...old.forms }; delete forms[key]; return { ...old, forms }; }); n.go({ page: "submissions", id: result.record.id }, true); }
    })(); } }])}>{t("finalSubmit")}</Button>{task.draft && <Button secondary disabled={busy} onPress={() => Alert.alert(t("loadSavedDraft"), t("discardHelp"), [{ text: t("cancel"), style: "cancel" }, { text: t("confirm"), onPress: () => { const next = task.draft?.responses ?? {}; setResponses(next); setRevision(task.draft?.revision ?? 0); baseline.current = JSON.stringify(next); n.setDirty(false); n.setError(undefined); } }])}>{t("loadSavedDraft")}</Button>}<Txt muted>{t("attemptRules")}</Txt></Card>
  </View>;
}
