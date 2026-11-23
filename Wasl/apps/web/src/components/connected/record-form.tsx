'use client';
import { useState, type FormEvent } from 'react';
import type { FileDto, QuestionOptionInput } from '@wasl/shared';
import type { Catalog, Row } from '@/lib/connected/catalog';
import { rowName, word } from '@/lib/connected/catalog';
import { api } from '@/lib/connected/http';
import { client, useApiSession } from './session';

export function ApiRecordForm({
  definition,
  row,
  references,
  submit,
  busy,
  dirty,
}: {
  definition: Catalog;
  row?: Row;
  references: Record<string, Row[]>;
  submit: (operation: () => Promise<Row>) => void;
  busy: boolean;
  dirty: () => void;
}) {
  const s = useApiSession();
  const ar = s.locale === 'ar';
  const editing = !!row;
  const fields = definition.fields.filter((f) => !editing || !f.createOnly);
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(
      fields.map((f) => [
        f.key,
        row?.[f.key] ??
          (f.type === 'checkbox'
            ? false
            : (f.options?.[0] ?? (f.type === 'number' ? (f.key === 'points' ? 1 : 0) : ''))),
      ]),
    ),
  );
  const [options, setOptions] = useState<QuestionOptionInput[]>(
    () =>
      (row?.options as QuestionOptionInput[] | undefined)?.map((o) => ({
        text: o.text,
        isCorrect: o.isCorrect,
      })) ?? [
        { text: '', isCorrect: true },
        { text: '', isCorrect: false },
      ],
  );
  const [file, setFile] = useState<File>();
  const [uploaded, setUploaded] = useState<FileDto>();
  const change = (key: string, value: unknown) => {
    setValues((old) => ({ ...old, [key]: value }));
    if (key === 'lessonId' || key === 'type') setUploaded(undefined);
    dirty();
  };
  const isFile = definition.key === 'resources' && values.type === 'FILE';
  function save(event: FormEvent) {
    event.preventDefault();
    submit(async () => {
      const body: Record<string, unknown> = {};
      for (const field of fields) {
        const raw = values[field.key];
        if (field.optional && (raw === '' || raw === undefined)) {
          if (editing || field.source || field.type === 'datetime-local') body[field.key] = null;
          continue;
        }
        body[field.key] =
          field.type === 'number'
            ? Number(raw)
            : field.type === 'checkbox'
              ? !!raw
              : field.type === 'datetime-local'
                ? new Date(String(raw)).toISOString()
                : raw;
      }
      let path = definition.path + (row ? '/' + row.id : '');
      if (definition.key === 'questions') {
        const type = String(values.type);
        body.options =
          type === 'TRUE_FALSE'
            ? [
                { text: 'True', isCorrect: options[0]?.isCorrect ?? true },
                { text: 'False', isCorrect: !(options[0]?.isCorrect ?? true) },
              ]
            : type === 'SHORT_ANSWER'
              ? [{ text: options[0]?.text ?? '', isCorrect: true }]
              : type === 'MULTIPLE_CHOICE'
                ? options
                : [];
        if (!row)
          path = 'question-banks/' + encodeURIComponent(String(body.questionBankId)) + '/questions';
        delete body.questionBankId;
      }
      if (definition.key === 'resources') {
        body.url = isFile ? null : String(values.url ?? '');
        body.storageKey = null;
        if (isFile) {
          let metadata = uploaded;
          if (!metadata && file) {
            const form = new FormData();
            form.append('purpose', 'LESSON_RESOURCE');
            form.append('lessonId', String(values.lessonId));
            form.append('file', file);
            metadata = await client.uploadFile(form);
            setUploaded(metadata);
          }
          body.storageKey = metadata?.storageKey ?? row?.storageKey;
          if (!body.storageKey) throw Object.assign(new Error('Choose a file'), { status: 400 });
        }
      }
      const result = await api<Row & { user?: Row; membership?: Row }>(
        path,
        row ? 'PATCH' : 'POST',
        body,
      );
      return result.user && definition.key === 'users'
        ? result.user
        : result.membership && definition.key === 'memberships'
          ? result.membership
          : result;
    });
  }
  const type = String(values.type ?? '');
  const currentOptions =
    type === 'TRUE_FALSE'
      ? [
          { text: 'True', isCorrect: options[0]?.isCorrect ?? true },
          { text: 'False', isCorrect: !(options[0]?.isCorrect ?? true) },
        ]
      : options;
  return (
    <form className="panel form-panel" onSubmit={save} aria-busy={busy}>
      <fieldset disabled={busy} className="form-grid workspace-fields">
        {fields
          .filter((f) => !(isFile && f.key === 'url'))
          .map((field) => {
            const value = values[field.key];
            const required =
              !field.optional ||
              (definition.key === 'announcements' &&
                field.key === 'sectionSubjectId' &&
                s.user?.activeRole === 'TEACHER');
            let dateValue = String(value ?? '');
            if (field.type === 'datetime-local' && dateValue.includes('Z')) {
              const d = new Date(dateValue);
              if (Number.isFinite(d.getTime()))
                dateValue = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
                  .toISOString()
                  .slice(0, 16);
            }
            return (
              <label key={field.key}>
                {field[ar ? 'ar' : 'en']}
                {field.source ? (
                  <select
                    name={field.key}
                    required={required}
                    value={String(value ?? '')}
                    onChange={(e) => change(field.key, e.target.value)}
                  >
                    <option value="">{ar ? 'اختر' : 'Select'}</option>
                    {(references[field.source] ?? []).map((r) => (
                      <option key={r.id} value={r.id}>
                        {rowName(r, ar)}
                      </option>
                    ))}
                  </select>
                ) : field.options ? (
                  <select
                    name={field.key}
                    value={String(value ?? '')}
                    onChange={(e) => {
                      change(field.key, e.target.value);
                      if (definition.key === 'questions' && field.key === 'type')
                        setOptions([
                          { text: '', isCorrect: true },
                          { text: '', isCorrect: false },
                        ]);
                    }}
                  >
                    {field.options.map((o) => (
                      <option key={o} value={o}>
                        {word(o, ar)}
                      </option>
                    ))}
                  </select>
                ) : field.type === 'textarea' ? (
                  <textarea
                    name={field.key}
                    rows={5}
                    required={required}
                    value={String(value ?? '')}
                    onChange={(e) => change(field.key, e.target.value)}
                  />
                ) : field.type === 'checkbox' ? (
                  <input
                    name={field.key}
                    type="checkbox"
                    checked={!!value}
                    onChange={(e) => change(field.key, e.target.checked)}
                  />
                ) : (
                  <input
                    name={field.key}
                    type={field.type ?? 'text'}
                    required={required}
                    autoComplete={field.type === 'password' ? 'new-password' : undefined}
                    minLength={field.type === 'password' ? 12 : undefined}
                    step={
                      field.key === 'points' ? 'any' : field.type === 'number' ? '1' : undefined
                    }
                    value={field.type === 'datetime-local' ? dateValue : String(value ?? '')}
                    onChange={(e) => change(field.key, e.target.value)}
                  />
                )}
              </label>
            );
          })}
        {isFile && (
          <label className="full-width">
            {ar ? 'الملف (حد أقصى 10 MB)' : 'File (up to 10 MB)'}
            <input
              name="file"
              type="file"
              required={!row?.storageKey && !uploaded}
              accept=".pdf,.png,.jpg,.jpeg,.txt,.docx,.xlsx,.pptx"
              onChange={(e) => {
                setFile(e.target.files?.[0]);
                setUploaded(undefined);
                dirty();
              }}
            />
            {uploaded && <small>{uploaded.originalName}</small>}
          </label>
        )}
        {definition.key === 'questions' &&
          ['MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER'].includes(type) && (
            <section className="full-width">
              <h3>
                {ar
                  ? type === 'SHORT_ANSWER'
                    ? 'الإجابة المقبولة'
                    : 'الخيارات والإجابة الصحيحة'
                  : type === 'SHORT_ANSWER'
                    ? 'Accepted answer'
                    : 'Options and correct answer'}
              </h3>
              {(type === 'SHORT_ANSWER' ? [options[0]] : currentOptions).map((option, i) => (
                <div className="question-option" key={i}>
                  <input
                    aria-label={(ar ? 'الخيار ' : 'Option ') + (i + 1)}
                    required
                    value={option?.text ?? ''}
                    readOnly={type === 'TRUE_FALSE'}
                    onChange={(e) => {
                      setOptions((old) =>
                        old.map((o, n) => (n === i ? { ...o, text: e.target.value } : o)),
                      );
                      dirty();
                    }}
                  />
                  {type !== 'SHORT_ANSWER' && (
                    <label>
                      <input
                        aria-label={(ar ? 'الإجابة الصحيحة ' : 'Correct answer ') + (i + 1)}
                        type="radio"
                        name="correct"
                        checked={!!option?.isCorrect}
                        onChange={() => {
                          setOptions(currentOptions.map((o, n) => ({ ...o, isCorrect: n === i })));
                          dirty();
                        }}
                      />
                      {ar ? 'صحيح' : 'Correct'}
                    </label>
                  )}
                </div>
              ))}
              {type === 'MULTIPLE_CHOICE' && (
                <button
                  className="button secondary"
                  type="button"
                  disabled={options.length >= 50}
                  onClick={() => {
                    setOptions([...options, { text: '', isCorrect: false }]);
                    dirty();
                  }}
                >
                  {ar ? 'إضافة خيار' : 'Add option'}
                </button>
              )}
            </section>
          )}
      </fieldset>
      <div className="form-actions">
        <button className="button" disabled={busy} type="submit">
          {ar ? 'حفظ' : 'Save'}
        </button>
      </div>
    </form>
  );
}
