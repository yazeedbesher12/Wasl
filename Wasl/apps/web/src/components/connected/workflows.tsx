'use client';
import { useEffect, useState } from 'react';
import type {
  AssessmentDetailDto,
  AnswerInput,
  Role,
  SubmissionDto,
} from '@wasl/shared';
import { client, useApiSession } from './session';
import { all, errorText } from '@/lib/connected/http';
import { rowName, word, type Row } from '@/lib/connected/catalog';
import type { Run } from './workspace';
import { toneForStatus } from '@wasl/shared/demo';
import Link from 'next/link';
type Question = AssessmentDetailDto['questions'][number];
type Download = (key: string) => Promise<unknown>;
export function AssessmentPanel({
  row,
  role,
  run,
  busy,
  dirty,
  download,
}: {
  row: Row;
  role: Role;
  run: Run;
  busy: boolean;
  dirty: () => void;
  download: Download;
}) {
  const s = useApiSession();
  const ar = s.locale === 'ar';
  const a = row as unknown as AssessmentDetailDto;
  const [own, setOwn] = useState<SubmissionDto>();
  const [ownReady, setOwnReady] = useState(false);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 3000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (role !== 'STUDENT') return;
    let active = true;
    setOwnReady(false);
    void client
      .ownAssessmentSubmission(a.id)
      .then((sub) => {
        if (active) {
          setOwn(sub);
          setResponses(
            Object.fromEntries(
              sub.answers.map((answer) => [
                answer.questionId,
                answer.fileKey ?? answer.response ?? '',
              ]),
            ),
          );
        }
      })
      .catch((e) => {
        if (active && e.status !== 404) setError(errorText(e, ar));
      })
      .finally(() => {
        if (active) setOwnReady(true);
      });
    return () => {
      active = false;
    };
  }, [a.id, role, ar]);
  const open =
    role === 'STUDENT' &&
    ownReady &&
    !error &&
    a.status === 'OPEN' &&
    (!a.opensAt || Date.parse(a.opensAt) <= now) &&
    (!a.dueAt || Date.parse(a.dueAt) > now) &&
    (!own || own.status === 'IN_PROGRESS');
  const change = (id: string, value: string) => {
    setResponses((old) => ({ ...old, [id]: value }));
    dirty();
  };
  const answers = (): AnswerInput[] =>
    a.questions.flatMap((q) => {
      const value = responses[q.id];
      if (!value) return [];
      return [
        {
          questionId: q.id,
          ...(q.type === 'FILE_UPLOAD'
            ? { fileKey: value }
            : ['MULTIPLE_CHOICE', 'TRUE_FALSE'].includes(q.type)
              ? { optionId: value }
              : { text: value }),
        },
      ];
    });
  async function upload(q: Question, file?: File) {
    if (!file) return;
    const epoch = s.generation.current;
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('purpose', 'ASSESSMENT_ANSWER');
      form.append('assessmentId', a.id);
      form.append('file', file);
      const f = await client.uploadFile(form);
      if (epoch === s.generation.current) {
        change(q.id, f.storageKey);
        setFileNames((old) => ({ ...old, [q.id]: f.originalName }));
      }
    } catch (e) {
      if (epoch === s.generation.current) setError(errorText(e, ar));
    } finally {
      setUploading(false);
    }
  }
  const transition = (
    action: 'publish' | 'unpublish' | 'close' | 'start-grading' | 'release' | 'archive',
  ) => {
    if (!window.confirm(ar ? 'تأكيد تنفيذ العملية؟' : 'Confirm this action?')) return;
    const operations = {
      publish: client.publishAssessment.bind(client),
      unpublish: client.unpublishAssessment.bind(client),
      close: client.closeAssessment.bind(client),
      'start-grading': client.startAssessmentGrading.bind(client),
      release: client.releaseAssessmentResults.bind(client),
      archive: client.archiveAssessment.bind(client),
    };
    void run(() => operations[action](a.id));
  };
  const actions: {
    action: 'publish' | 'unpublish' | 'close' | 'start-grading' | 'release' | 'archive';
    ar: string;
    en: string;
  }[] =
    a.status === 'DRAFT'
      ? [{ action: 'publish', ar: 'نشر', en: 'Publish' }]
      : ['OPEN', 'SCHEDULED'].includes(a.status)
        ? [
            { action: 'close', ar: 'إغلاق', en: 'Close' },
            { action: 'unpublish', ar: 'إلغاء النشر', en: 'Unpublish' },
          ]
        : a.status === 'CLOSED'
          ? [{ action: 'start-grading', ar: 'بدء التصحيح', en: 'Start grading' }]
          : a.status === 'GRADING'
            ? [{ action: 'release', ar: 'نشر النتائج', en: 'Release results' }]
            : a.status === 'RESULTS_RELEASED'
              ? [{ action: 'archive', ar: 'أرشفة', en: 'Archive' }]
              : [];
  return (
    <>
      <section className="panel profile-panel">
        <h2>{a.title}</h2>
        <span className={'badge tone-' + toneForStatus(a.status)}>{word(a.status, ar)}</span>
        <p className="long-content">{a.instructions}</p>
        <dl className="definition-list">
          <div>
            <dt>{ar ? 'موعد الفتح' : 'Opens at'}</dt>
            <dd>{a.opensAt ? new Date(a.opensAt).toLocaleString(ar ? 'ar-PS' : 'en-GB') : '—'}</dd>
          </div>
          <div>
            <dt>{ar ? 'آخر موعد للتسليم' : 'Deadline'}</dt>
            <dd>{a.dueAt ? new Date(a.dueAt).toLocaleString(ar ? 'ar-PS' : 'en-GB') : '—'}</dd>
          </div>
          <div>
            <dt>{ar ? 'الأسئلة / العلامة' : 'Questions / Points'}</dt>
            <dd>
              {a.questionCount} / {a.totalPoints}
            </dd>
          </div>
        </dl>
        {role === 'TEACHER' && (
          <div className="actions">
            {a.status === 'DRAFT' && (
              <Link className="button secondary" href={`/teacher/assessments/${a.id}/edit`}>
                {ar ? 'تعديل' : 'Edit'}
              </Link>
            )}
            {actions.map((action) => (
              <button
                className="button secondary"
                key={action.action}
                disabled={busy}
                onClick={() => transition(action.action)}
              >
                {action[ar ? 'ar' : 'en']}
              </button>
            ))}
          </div>
        )}
      </section>
      {role === 'TEACHER' && a.status === 'DRAFT' ? (
        <AssessmentQuestions assessment={a} run={run} busy={busy} dirty={dirty} />
      ) : (
        <section className="panel">
          <h2>{ar ? 'الأسئلة' : 'Questions'}</h2>
          {error && (
            <p role="alert" className="form-alert">
              {error}
            </p>
          )}
          {a.questions.length === 0 && (
            <p>
              {ar
                ? 'الأسئلة غير متاحة قبل موعد الفتح.'
                : 'Questions are unavailable before the opening time.'}
            </p>
          )}
          {a.questions.map((q, index) => (
            <article className="result-question" key={q.id}>
              <h3>
                {index + 1}. {q.text} <small>({q.points})</small>
              </h3>
              {['MULTIPLE_CHOICE', 'TRUE_FALSE'].includes(q.type) ? (
                q.options.map((option) => (
                  <label className="question-option" key={option.id}>
                    {role === 'STUDENT' && (
                      <input
                        type="radio"
                        name={`question-${q.id}`}
                        disabled={!open || busy || uploading}
                        checked={responses[q.id] === option.id}
                        onChange={() => change(q.id, option.id)}
                      />
                    )}
                    {option.text}
                    {role === 'TEACHER' && 'isCorrect' in option && Boolean(option.isCorrect) && (
                      <span className="badge tone-success">{ar ? 'صحيح' : 'Correct'}</span>
                    )}
                  </label>
                ))
              ) : q.type === 'FILE_UPLOAD' ? (
                <div>
                  {open && (
                    <label>
                      {ar ? 'رفع ملف الإجابة (10 MB)' : 'Upload answer file (10 MB)'}
                      <input
                        type="file"
                        disabled={busy || uploading}
                        accept=".pdf,.png,.jpg,.jpeg,.txt,.docx,.xlsx,.pptx"
                        onChange={(e) => void upload(q, e.target.files?.[0])}
                      />
                    </label>
                  )}
                  {responses[q.id] && (
                    <button
                      className="button secondary"
                      disabled={busy || uploading}
                      onClick={() => void download(responses[q.id])}
                    >
                      {fileNames[q.id] || (ar ? 'تنزيل الملف المرفوع' : 'Download uploaded file')}
                    </button>
                  )}
                </div>
              ) : role === 'STUDENT' ? (
                <label>
                  {ar ? 'إجابتك' : 'Your answer'}
                  <textarea
                    name={`answer-${q.id}`}
                    rows={4}
                    value={responses[q.id] ?? ''}
                    disabled={!open || busy || uploading}
                    onChange={(e) => change(q.id, e.target.value)}
                  />
                </label>
              ) : null}
            </article>
          ))}
          {role === 'STUDENT' &&
            (open ? (
              <div className="actions">
                <button
                  className="button secondary"
                  disabled={busy || uploading}
                  onClick={() =>
                    void run(() => client.saveAssessmentAnswers(a.id, { answers: answers() }))
                  }
                >
                  {ar ? 'حفظ مسودة الإجابات' : 'Save answer draft'}
                </button>
                <button
                  className="button"
                  disabled={busy || uploading}
                  onClick={() => {
                    if (
                      window.confirm(
                        ar
                          ? 'تأكيد التسليم النهائي؟ لا يمكن تعديل الإجابات بعده.'
                          : 'Submit final answers? They cannot be edited afterwards.',
                      )
                    )
                      void run(() => client.submitAssessment(a.id, { answers: answers() }));
                  }}
                >
                  {ar ? 'تسليم نهائي' : 'Submit final'}
                </button>
              </div>
            ) : (
              <p className="banner">
                {own && own.status !== 'IN_PROGRESS'
                  ? ar
                    ? 'تم تسليم إجاباتك.'
                    : 'Your answers were submitted.'
                  : ar
                    ? 'التقييم غير مفتوح للتسليم حاليًا.'
                    : 'This assessment is not open for submission.'}
              </p>
            ))}
          {own && (
            <p>
              <Link href={`/student/submissions/${own.id}`}>
                {ar ? 'عرض إيصال التسليم' : 'View submission receipt'}
              </Link>
            </p>
          )}
        </section>
      )}
    </>
  );
}
function AssessmentQuestions({
  assessment,
  run,
  busy,
  dirty,
}: {
  assessment: AssessmentDetailDto;
  run: Run;
  busy: boolean;
  dirty: () => void;
}) {
  const s = useApiSession();
  const ar = s.locale === 'ar';
  const [banks, setBanks] = useState<Row[]>([]);
  const [bank, setBank] = useState('');
  const [available, setAvailable] = useState<Question[]>([]);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Question[]>(assessment.questions);
  useEffect(() => {
    let active = true;
    void all<Row>('question-banks')
      .then((rows) => {
        if (active) setBanks(rows);
      })
      .catch((e) => {
        if (active) setError(errorText(e, ar));
      });
    return () => {
      active = false;
    };
  }, [ar]);
  useEffect(() => {
    const id = bank || banks[0]?.id;
    if (!id) return;
    let active = true;
    void all<Question & Row>('question-banks/' + id + '/questions')
      .then((rows) => {
        if (active) setAvailable(rows);
      })
      .catch((e) => {
        if (active) setError(errorText(e, ar));
      });
    return () => {
      active = false;
    };
  }, [bank, banks, ar]);
  return (
    <section className="panel">
      <h2>{ar ? 'اختيار الأسئلة وترتيبها' : 'Select and order questions'}</h2>
      {error && <p role="alert">{error}</p>}
      <label>
        {ar ? 'بنك الأسئلة' : 'Question bank'}
        <select value={bank || banks[0]?.id || ''} onChange={(e) => setBank(e.target.value)}>
          {banks.map((b) => (
            <option key={b.id} value={b.id}>
              {rowName(b, ar)}
            </option>
          ))}
        </select>
      </label>
      <div className="learning-list">
        {available
          .filter((q) => !selected.some((v) => v.id === q.id))
          .map((q) => (
            <div className="learning-row" key={q.id}>
              <span>{q.text}</span>
              <button
                className="button secondary"
                disabled={busy || selected.length >= 200}
                onClick={() => {
                  setSelected([...selected, q]);
                  dirty();
                }}
              >
                {ar ? 'إضافة السؤال' : 'Add question'}
              </button>
            </div>
          ))}
      </div>
      <ol>
        {selected.map((q, i) => (
          <li key={q.id} className="learning-row">
            <span>{q.text}</span>
            <div className="actions">
              <button
                className="button secondary"
                aria-label={ar ? 'تحريك للأعلى' : 'Move up'}
                disabled={busy || i === 0}
                onClick={() => {
                  const next = [...selected];
                  [next[i - 1], next[i]] = [next[i], next[i - 1]];
                  setSelected(next);
                  dirty();
                }}
              >
                ↑
              </button>
              <button
                className="button secondary"
                aria-label={ar ? 'تحريك للأسفل' : 'Move down'}
                disabled={busy || i === selected.length - 1}
                onClick={() => {
                  const next = [...selected];
                  [next[i + 1], next[i]] = [next[i], next[i + 1]];
                  setSelected(next);
                  dirty();
                }}
              >
                ↓
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  setSelected(selected.filter((v) => v.id !== q.id));
                  dirty();
                }}
              >
                {ar ? 'إزالة' : 'Remove'}
              </button>
            </div>
          </li>
        ))}
      </ol>
      <button
        className="button"
        disabled={busy}
        onClick={() =>
          void run(() =>
            client.replaceAssessmentQuestions(assessment.id, {
              questions: selected.map((q, order) => ({ questionId: q.id, order })),
            }),
          )
        }
      >
        {ar ? 'حفظ أسئلة التقييم' : 'Save assessment questions'}
      </button>
    </section>
  );
}
export function SubmissionPanel({
  row,
  role,
  run,
  busy,
  dirty,
  download,
  child,
  school,
}: {
  row: Row;
  role: Role;
  run: Run;
  busy: boolean;
  dirty: () => void;
  download: Download;
  child?: string;
  school?: string;
}) {
  const s = useApiSession();
  const ar = s.locale === 'ar';
  const sub = row as unknown as SubmissionDto;
  const [assessment, setAssessment] = useState<AssessmentDetailDto>();
  const [scores, setScores] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState(sub.feedback ?? '');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const operation =
      role === 'PARENT' && child
        ? client.childAssessment(child, sub.assessmentId, school)
        : client.assessment(sub.assessmentId);
    void operation
      .then((a) => {
        if (active) {
          setAssessment(a);
          setScores(
            Object.fromEntries(
              sub.answers.map((answer) => [
                answer.questionId,
                answer.score === null ? '' : String(answer.score),
              ]),
            ),
          );
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e, ar));
      });
    return () => {
      active = false;
    };
  }, [sub.id, sub.assessmentId, sub.answers, role, child, school, ar]);
  const canGrade =
    role === 'TEACHER' &&
    !!assessment &&
    ['CLOSED', 'GRADING'].includes(assessment.status) &&
    sub.status !== 'IN_PROGRESS';
  return (
    <section className="panel">
      <h2>{assessment?.title || (ar ? 'التسليم' : 'Submission')}</h2>
      {error && <p role="alert">{error}</p>}
      <p className={'badge tone-' + toneForStatus(sub.status)}>{word(sub.status, ar)}</p>
      <p dir="ltr">{sub.id}</p>
      <p>
        {sub.submittedAt
          ? new Date(sub.submittedAt).toLocaleString(ar ? 'ar-PS' : 'en-GB')
          : ar
            ? 'لم يتم التسليم النهائي بعد.'
            : 'Not submitted yet.'}
      </p>
      <p>
        {ar ? 'العلامة' : 'Score'}:{' '}
        {sub.score === null
          ? ar
            ? 'لم تُنشر النتيجة بعد.'
            : 'Result not released yet.'
          : `${sub.score} / ${assessment?.totalPoints ?? row.totalPoints ?? ''}`}
      </p>
      {sub.feedback && <p className="long-content">{sub.feedback}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() =>
            client.gradeSubmission(sub.id, {
              answers: sub.answers.map((a) => ({
                questionId: a.questionId,
                score: Number(scores[a.questionId]),
              })),
              feedback,
            }),
          );
        }}
      >
        {sub.answers.map((answer) => {
          const q = assessment?.questions.find((q) => q.id === answer.questionId);
          const response =
            q?.options.find((o) => o.id === answer.response)?.text ?? answer.response;
          return (
            <article className="result-question" key={answer.id}>
              <h3>{q?.text ?? (ar ? 'السؤال' : 'Question')}</h3>
              {response && <p className="long-content">{response}</p>}
              {answer.fileKey && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void download(answer.fileKey!)}
                >
                  {ar ? 'تنزيل ملف الإجابة' : 'Download answer file'}
                </button>
              )}
              {answer.score !== null && (
                <p>
                  {answer.score} / {q?.points ?? ''}
                </p>
              )}
              {canGrade && (
                <label>
                  {ar ? 'علامة السؤال' : 'Question score'}
                  <input
                    type="number"
                    name={`score-${answer.questionId}`}
                    required
                    min={0}
                    max={q?.points}
                    step="any"
                    value={scores[answer.questionId] ?? ''}
                    onChange={(e) => {
                      setScores((old) => ({ ...old, [answer.questionId]: e.target.value }));
                      dirty();
                    }}
                  />
                </label>
              )}
            </article>
          );
        })}
        {canGrade && (
          <>
            <label>
              {ar ? 'ملاحظات للطالب' : 'Feedback for the student'}
              <textarea
                value={feedback}
                onChange={(e) => {
                  setFeedback(e.target.value);
                  dirty();
                }}
              />
            </label>
            <button className="button" disabled={busy}>
              {ar ? 'حفظ التصحيح' : 'Save grading'}
            </button>
          </>
        )}
      </form>
      {role === 'TEACHER' && assessment?.status === 'OPEN' && (
        <p>{ar ? 'أغلق التقييم قبل بدء التصحيح.' : 'Close the assessment before grading.'}</p>
      )}
      {role === 'TEACHER' && (
        <Link className="button secondary" href={`/teacher/assessments/${sub.assessmentId}`}>
          {ar ? 'فتح التقييم ونشر النتائج' : 'Open assessment and release results'}
        </Link>
      )}
    </section>
  );
}
