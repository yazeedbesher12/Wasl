import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { AnswerInput, AssessmentDetailDto, SubmissionDto } from '@wasl/shared';
import { rowName, word, type Row } from '../../../../packages/shared/src/connected';
import { Button, Card, Field, Select, Txt, styles } from '../ui';
import { confirmAction, useConnected } from './context';
import { download, upload } from './files';

export function AssessmentView({ row }: { row: Row }) {
  const n = useConnected();
  const { ar, api, role } = n;
  const a = row as unknown as AssessmentDetailDto;
  const [own, setOwn] = useState<SubmissionDto>();
  const [loaded, setLoaded] = useState(role !== 'STUDENT');
  const [error, setError] = useState(false);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 3000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (role !== 'STUDENT') return;
    let active = true;
    void api
      .call<SubmissionDto>(`assessments/${a.id}/submission`)
      .then((s) => {
        if (active) {
          setOwn(s);
          setResponses(
            Object.fromEntries(s.answers.map((v) => [v.questionId, v.fileKey ?? v.response ?? ''])),
          );
        }
      })
      .catch((e) => {
        if (active && e.status !== 404) setError(true);
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [a.id]);
  const open =
    loaded &&
    !error &&
    role === 'STUDENT' &&
    a.status === 'OPEN' &&
    (!a.opensAt || Date.parse(a.opensAt) <= now) &&
    (!a.dueAt || Date.parse(a.dueAt) > now) &&
    (!own || own.status === 'IN_PROGRESS');
  const change = (id: string, response: string) => {
    setResponses((r) => ({ ...r, [id]: response }));
    n.setDirty(true);
  };
  const answers = (): AnswerInput[] =>
    a.questions.flatMap((q) =>
      !responses[q.id]
        ? []
        : [
            {
              questionId: q.id,
              ...(q.type === 'FILE_UPLOAD'
                ? { fileKey: responses[q.id] }
                : ['MULTIPLE_CHOICE', 'TRUE_FALSE'].includes(q.type)
                  ? { optionId: responses[q.id] }
                  : { text: responses[q.id] }),
            },
          ],
    );
  const transition = async (action: string) => {
    if (await confirmAction(ar ? 'تأكيد تنفيذ العملية؟' : 'Confirm this action?'))
      void n.run(() => api.call(`assessments/${a.id}/${action}`, 'POST'));
  };
  const actions =
    a.status === 'DRAFT'
      ? ['publish']
      : ['OPEN', 'SCHEDULED'].includes(a.status)
        ? ['close', 'unpublish']
        : a.status === 'CLOSED'
          ? ['start-grading']
          : a.status === 'GRADING'
            ? ['release']
            : a.status === 'RESULTS_RELEASED'
              ? ['archive']
              : [];
  const labels: Record<string, [string, string]> = {
    publish: ['نشر', 'Publish'],
    unpublish: ['إلغاء النشر', 'Unpublish'],
    close: ['إغلاق', 'Close'],
    'start-grading': ['بدء التصحيح', 'Start grading'],
    release: ['نشر النتائج', 'Release results'],
    archive: ['أرشفة', 'Archive'],
  };
  return (
    <>
      <Card>
        <Txt title>{a.title}</Txt>
        <Txt>
          {word(a.status, ar)} · {a.questionCount} / {a.totalPoints}
        </Txt>
        <Txt>{a.instructions}</Txt>
        {a.opensAt && (
          <Txt>
            {ar ? 'الفتح: ' : 'Opens: '}
            {new Date(a.opensAt).toLocaleString()}
          </Txt>
        )}
        {a.dueAt && (
          <Txt>
            {ar ? 'آخر موعد: ' : 'Deadline: '}
            {new Date(a.dueAt).toLocaleString()}
          </Txt>
        )}
        {role === 'TEACHER' && (
          <>
            <View style={styles.row}>
              {a.status === 'DRAFT' && (
                <Button
                  secondary
                  onPress={() => void n.go({ page: 'assessments', id: a.id, edit: true })}
                >
                  {ar ? 'تعديل' : 'Edit'}
                </Button>
              )}
              {actions.map((action) => (
                <Button
                  key={action}
                  secondary
                  disabled={n.dirty}
                  onPress={() => void transition(action)}
                >
                  {labels[action][ar ? 0 : 1]}
                </Button>
              ))}
            </View>
            {n.dirty && (
              <Txt>{ar ? 'احفظ الأسئلة قبل النشر.' : 'Save questions before publication.'}</Txt>
            )}
          </>
        )}
      </Card>
      {role === 'TEACHER' && a.status === 'DRAFT' ? (
        <AssessmentQuestions a={a} />
      ) : (
        <Card>
          <Txt title>{ar ? 'الأسئلة' : 'Questions'}</Txt>
          {error && (
            <Txt accessibilityRole="alert">
              {ar ? 'تعذر تحميل الإجابات.' : 'Could not load your answers.'}
            </Txt>
          )}
          {!loaded && <Txt>{ar ? 'تحميل الإجابات...' : 'Loading answers...'}</Txt>}
          {!a.questions.length && (
            <Txt>
              {ar
                ? 'الأسئلة غير متاحة قبل موعد الفتح.'
                : 'Questions are unavailable before opening.'}
            </Txt>
          )}
          {a.questions.map((q, i) => (
            <View key={q.id} style={{ marginVertical: 12, gap: 10 }}>
              <Txt title>
                {i + 1}. {q.text} ({q.points})
              </Txt>
              {q.options.length > 0 && q.type !== 'SHORT_ANSWER' ? (
                q.options.map((o) =>
                  role === 'STUDENT' ? (
                    <Button
                      key={o.id}
                      secondary
                      disabled={!open}
                      onPress={() => change(q.id, o.id)}
                    >
                      {responses[q.id] === o.id ? '✓ ' : ''}
                      {o.text}
                    </Button>
                  ) : (
                    <Txt key={o.id}>
                      {o.text}
                      {role === 'TEACHER' && 'isCorrect' in o && o.isCorrect ? ' ✓' : ''}
                    </Txt>
                  ),
                )
              ) : q.type === 'FILE_UPLOAD' ? (
                <View style={{ gap: 8 }}>
                  {open && (
                    <Button
                      secondary
                      onPress={() =>
                        void n.run(
                          () => upload(api, 'ASSESSMENT_ANSWER', a.id),
                          (f) => {
                            if (f) {
                              change(q.id, f.storageKey);
                              setFiles((v) => ({ ...v, [q.id]: f.originalName }));
                            }
                          },
                          false,
                        )
                      }
                    >
                      {ar ? 'رفع ملف الإجابة' : 'Upload answer file'}
                    </Button>
                  )}
                  {responses[q.id] && (
                    <Button
                      secondary
                      onPress={() =>
                        void n.run(() => download(api, responses[q.id]), undefined, false)
                      }
                    >
                      {files[q.id] || (ar ? 'تنزيل الملف' : 'Download file')}
                    </Button>
                  )}
                </View>
              ) : (
                role === 'STUDENT' && (
                  <Field
                    label={ar ? 'إجابتك' : 'Your answer'}
                    value={responses[q.id] ?? ''}
                    editable={open}
                    multiline
                    onChangeText={(v) => change(q.id, v)}
                  />
                )
              )}
            </View>
          ))}
          {role === 'STUDENT' && open && (
            <>
              <Button
                secondary
                onPress={() =>
                  void n.run(() =>
                    api.call(`assessments/${a.id}/submission`, 'PUT', { answers: answers() }),
                  )
                }
              >
                {ar ? 'حفظ مسودة الإجابات' : 'Save answer draft'}
              </Button>
              <Button
                onPress={() =>
                  void confirmAction(
                    ar
                      ? 'تأكيد التسليم النهائي؟ لن يمكنك التعديل بعده.'
                      : 'Submit final answers? They cannot be edited afterwards.',
                  ).then((ok) => {
                    if (ok)
                      void n.run(() =>
                        api.call(`assessments/${a.id}/submit`, 'POST', { answers: answers() }),
                      );
                  })
                }
              >
                {ar ? 'تسليم نهائي' : 'Submit final'}
              </Button>
            </>
          )}
          {role === 'STUDENT' && own && (
            <>
              <Txt>
                {own.status !== 'IN_PROGRESS'
                  ? ar
                    ? 'تم تسليم إجاباتك.'
                    : 'Your answers were submitted.'
                  : word(own.status, ar)}
              </Txt>
              <Button secondary onPress={() => void n.go({ page: 'submissions', id: own.id })}>
                {ar ? 'إيصال التسليم' : 'Submission receipt'}
              </Button>
            </>
          )}
        </Card>
      )}
    </>
  );
}
function AssessmentQuestions({ a }: { a: AssessmentDetailDto }) {
  const n = useConnected();
  const { api, ar } = n;
  const [banks, setBanks] = useState<Row[]>([]);
  const [bank, setBank] = useState('');
  const [available, setAvailable] = useState<Row[]>([]);
  const [selected, setSelected] = useState(a.questions.map((q) => ({ id: q.id, text: q.text })));
  useEffect(() => {
    let active = true;
    void api
      .all<Row>('question-banks')
      .then((rows) => {
        if (active) setBanks(rows);
      })
      .catch(() => {
        if (active) n.setError(ar ? 'تعذر تحميل البنوك.' : 'Could not load question banks.');
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const id = bank || banks[0]?.id;
    if (!id) return;
    let active = true;
    void api
      .all<Row>(`question-banks/${id}/questions`)
      .then((rows) => {
        if (active) setAvailable(rows);
      })
      .catch(() => {
        if (active) n.setError(ar ? 'تعذر تحميل الأسئلة.' : 'Could not load questions.');
      });
    return () => {
      active = false;
    };
  }, [bank, banks]);
  return (
    <Card>
      <Txt title>{ar ? 'اختيار الأسئلة وترتيبها' : 'Select and order questions'}</Txt>
      <Select
        label={ar ? 'بنك الأسئلة' : 'Question bank'}
        value={bank || banks[0]?.id || ''}
        options={banks.map((b) => ({ value: b.id, label: rowName(b, ar) }))}
        onChange={setBank}
      />
      {available
        .filter((q) => !selected.some((v) => v.id === q.id))
        .map((q) => (
          <Button
            key={q.id}
            secondary
            disabled={selected.length >= 200}
            onPress={() => {
              setSelected([...selected, { id: q.id, text: String(q.text) }]);
              n.setDirty(true);
            }}
          >
            + {String(q.text)}
          </Button>
        ))}
      {selected.map((q, i) => (
        <View key={q.id}>
          <Txt>
            {i + 1}. {q.text}
          </Txt>
          <View style={styles.row}>
            <Button
              secondary
              disabled={i === 0}
              onPress={() => {
                const next = [...selected];
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                setSelected(next);
                n.setDirty(true);
              }}
            >
              ↑
            </Button>
            <Button
              secondary
              disabled={i === selected.length - 1}
              onPress={() => {
                const next = [...selected];
                [next[i + 1], next[i]] = [next[i], next[i + 1]];
                setSelected(next);
                n.setDirty(true);
              }}
            >
              ↓
            </Button>
            <Button
              secondary
              onPress={() => {
                setSelected(selected.filter((v) => v.id !== q.id));
                n.setDirty(true);
              }}
            >
              {ar ? 'إزالة' : 'Remove'}
            </Button>
          </View>
        </View>
      ))}
      <Button
        onPress={() =>
          void n.run(() =>
            api.call(`assessments/${a.id}/questions`, 'PUT', {
              questions: selected.map((q, order) => ({ questionId: q.id, order })),
            }),
          )
        }
      >
        {ar ? 'حفظ أسئلة التقييم' : 'Save assessment questions'}
      </Button>
    </Card>
  );
}
export function SubmissionView({ row }: { row: Row }) {
  const n = useConnected();
  const { ar, api, role } = n;
  const sub = row as unknown as SubmissionDto;
  const [a, setAssessment] = useState<AssessmentDetailDto>();
  const [scores, setScores] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState(sub.feedback ?? '');
  useEffect(() => {
    let active = true;
    const path =
      role === 'PARENT' && n.child
        ? `parent/children/${n.child.student.id}/assessments/${sub.assessmentId}?schoolId=${n.child.school.id}`
        : `assessments/${sub.assessmentId}`;
    void api
      .call<AssessmentDetailDto>(path)
      .then((a) => {
        if (active) {
          setAssessment(a);
          setScores(
            Object.fromEntries(
              sub.answers.map((v) => [v.questionId, v.score === null ? '' : String(v.score)]),
            ),
          );
        }
      })
      .catch(() => {
        if (active) n.setError(ar ? 'تعذر تحميل التقييم.' : 'Could not load assessment.');
      });
    return () => {
      active = false;
    };
  }, [sub.id]);
  const canGrade =
    role === 'TEACHER' &&
    a &&
    ['CLOSED', 'GRADING'].includes(a.status) &&
    sub.status !== 'IN_PROGRESS';
  return (
    <Card>
      <Txt title>{a?.title || String(row.title ?? (ar ? 'التسليم' : 'Submission'))}</Txt>
      <Txt>{word(sub.status, ar)}</Txt>
      <Txt ltr>{sub.id}</Txt>
      {sub.submittedAt && <Txt>{new Date(sub.submittedAt).toLocaleString()}</Txt>}
      <Txt>
        {ar ? 'العلامة: ' : 'Score: '}
        {sub.score === null
          ? ar
            ? 'لم تُنشر النتيجة بعد.'
            : 'Result not released yet.'
          : `${sub.score} / ${a?.totalPoints ?? row.totalPoints ?? ''}`}
      </Txt>
      {sub.feedback && <Txt>{sub.feedback}</Txt>}
      {sub.answers.map((answer) => {
        const q = a?.questions.find((q) => q.id === answer.questionId);
        return (
          <View key={answer.id} style={{ gap: 10, marginVertical: 12 }}>
            <Txt title>{q?.text ?? (ar ? 'السؤال' : 'Question')}</Txt>
            {answer.response && (
              <Txt>{q?.options.find((o) => o.id === answer.response)?.text ?? answer.response}</Txt>
            )}
            {answer.fileKey && (
              <Button
                secondary
                onPress={() => void n.run(() => download(api, answer.fileKey!), undefined, false)}
              >
                {ar ? 'تنزيل الإجابة' : 'Download answer'}
              </Button>
            )}
            {answer.score !== null && (
              <Txt>
                {answer.score} / {q?.points ?? ''}
              </Txt>
            )}
            {canGrade && (
              <Field
                label={(ar ? 'علامة السؤال / ' : 'Question score / ') + q?.points}
                keyboardType="decimal-pad"
                value={scores[answer.questionId] ?? ''}
                onChangeText={(score) => {
                  setScores((v) => ({ ...v, [answer.questionId]: score }));
                  n.setDirty(true);
                }}
              />
            )}
          </View>
        );
      })}
      {canGrade && (
        <>
          <Field
            label={ar ? 'ملاحظات للطالب' : 'Feedback for the student'}
            multiline
            value={feedback}
            onChangeText={(v) => {
              setFeedback(v);
              n.setDirty(true);
            }}
          />
          <Button
            onPress={() =>
              void n.run(async () => {
                for (const answer of sub.answers) {
                  const score = scores[answer.questionId];
                  const maximum = a?.questions.find((q) => q.id === answer.questionId)?.points;
                  if (
                    !score?.trim() ||
                    !Number.isFinite(Number(score)) ||
                    Number(score) < 0 ||
                    maximum === undefined ||
                    Number(score) > maximum
                  )
                    throw Object.assign(new Error(), { status: 400 });
                }
                return api.call(`submissions/${sub.id}/grade`, 'POST', {
                  answers: sub.answers.map((v) => ({
                    questionId: v.questionId,
                    score: Number(scores[v.questionId]),
                  })),
                  feedback,
                });
              })
            }
          >
            {ar ? 'حفظ التصحيح' : 'Save grading'}
          </Button>
        </>
      )}
      {role === 'TEACHER' && (
        <Button secondary onPress={() => void n.go({ page: 'assessments', id: sub.assessmentId })}>
          {ar ? 'فتح التقييم ونشر النتائج' : 'Open assessment and release results'}
        </Button>
      )}
    </Card>
  );
}
