import { useState } from 'react';
import { Switch, View } from 'react-native';
import type { FileDto, QuestionOptionInput } from '@wasl/shared';
import { catalog, rowName, word, type Row } from '../../../../packages/shared/src/connected';
import { Button, Card, Field, Select, Txt, styles } from '../ui';
import { useConnected } from './context';
import { upload } from './files';

export function RecordForm() {
  const n = useConnected();
  const { ar, key, record, refs, api } = n;
  const config = catalog[key];
  const editing = !!record;
  const fields = config.fields.filter((f) => !editing || !f.createOnly);
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(
      fields.map((f) => [
        f.key,
        record?.[f.key] ??
          (f.type === 'checkbox'
            ? false
            : (f.options?.[0] ?? (f.type === 'number' ? (f.key === 'points' ? 1 : 0) : ''))),
      ]),
    ),
  );
  const [options, setOptions] = useState<QuestionOptionInput[]>(
    () =>
      (record?.options as QuestionOptionInput[] | undefined)?.map((o) => ({
        text: o.text,
        isCorrect: o.isCorrect,
      })) ?? [
        { text: '', isCorrect: true },
        { text: '', isCorrect: false },
      ],
  );
  const [file, setFile] = useState<FileDto>();
  const change = (key: string, value: unknown) => {
    setValues((v) => ({ ...v, [key]: value }));
    n.setDirty(true);
    if (key === 'lessonId' || key === 'type') setFile(undefined);
  };
  const type = String(values.type ?? '');
  const isFile = key === 'resources' && type === 'FILE';
  const save = () =>
    void n.run(
      async () => {
        const body: Record<string, unknown> = {};
        for (const field of fields) {
          const raw = values[field.key];
          if (field.optional && (raw === '' || raw === undefined)) {
            if (editing || field.source || field.type === 'datetime-local') body[field.key] = null;
            continue;
          }
          if (raw === '' && field.type !== 'checkbox' && !(isFile && field.key === 'url'))
            throw Object.assign(new Error(), { status: 400 });
          if (field.type === 'number' && !Number.isFinite(Number(raw)))
            throw Object.assign(new Error(), { status: 400 });
          if (field.type === 'password' && String(raw).length < 12)
            throw Object.assign(new Error(), { status: 400 });
          if (field.type === 'datetime-local' && !Number.isFinite(Date.parse(String(raw))))
            throw Object.assign(new Error(), { status: 400 });
          body[field.key] =
            field.type === 'number'
              ? Number(raw)
              : field.type === 'checkbox'
                ? !!raw
                : field.type === 'datetime-local'
                  ? new Date(String(raw)).toISOString()
                  : raw;
        }
        let path = config.path + (record ? '/' + record.id : '');
        if (key === 'questions') {
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
          if (!record) path = `question-banks/${String(body.questionBankId)}/questions`;
          delete body.questionBankId;
        }
        if (key === 'resources') {
          body.url = isFile ? null : values.url;
          body.storageKey = isFile ? (file?.storageKey ?? record?.storageKey) : null;
          if (isFile && !body.storageKey) throw Object.assign(new Error(), { status: 400 });
        }
        const result = await api.call<Row & { user?: Row }>(path, editing ? 'PATCH' : 'POST', body);
        return key === 'users' && result.user ? result.user : result;
      },
      (result) => n.saved({ page: key, id: result.id }),
    );
  return (
    <Card>
      {fields
        .filter((f) => !(isFile && f.key === 'url'))
        .map((field) => {
          const label =
            field[ar ? 'ar' : 'en'] +
            (field.optional ? (ar ? ' (اختياري)' : ' (optional)') : '') +
            (field.type === 'date'
              ? ' · YYYY-MM-DD'
              : field.type === 'datetime-local'
                ? ' · YYYY-MM-DDTHH:mm'
                : '');
          if (field.type === 'checkbox')
            return (
              <View key={field.key} style={styles.row}>
                <Txt>{label}</Txt>
                <Switch
                  accessibilityLabel={label}
                  disabled={n.busy}
                  value={!!values[field.key]}
                  onValueChange={(v) => change(field.key, v)}
                />
              </View>
            );
          if (field.source || field.options)
            return (
              <Select
                key={field.key}
                label={label}
                optional={field.optional}
                value={String(values[field.key] ?? '')}
                options={
                  field.source
                    ? (refs[field.source] ?? []).map((r) => ({
                        value: r.id,
                        label: rowName(r, ar),
                      }))
                    : field.options!.map((o) => ({ value: o, label: word(o, ar) }))
                }
                onChange={(v) => {
                  change(field.key, v);
                  if (key === 'questions' && field.key === 'type')
                    setOptions([
                      { text: '', isCorrect: true },
                      { text: '', isCorrect: false },
                    ]);
                }}
              />
            );
          return (
            <Field
              key={field.key}
              label={label}
              value={String(values[field.key] ?? '')}
              onChangeText={(v) => change(field.key, v)}
              multiline={field.type === 'textarea'}
              secureTextEntry={field.type === 'password'}
              autoCapitalize={field.type === 'email' ? 'none' : 'sentences'}
              keyboardType={
                field.type === 'number'
                  ? 'decimal-pad'
                  : field.type === 'email'
                    ? 'email-address'
                    : 'default'
              }
            />
          );
        })}
      {isFile && (
        <>
          <Button
            secondary
            disabled={!values.lessonId}
            onPress={() =>
              void n.run(
                () => upload(api, 'LESSON_RESOURCE', String(values.lessonId)),
                (f) => {
                  if (f) {
                    setFile(f);
                    n.setDirty(true);
                  }
                },
                false,
              )
            }
          >
            {ar ? 'اختيار ورفع ملف (10 MB)' : 'Choose and upload file (10 MB)'}
          </Button>
          {file && <Txt>{file.originalName}</Txt>}
        </>
      )}
      {key === 'questions' && ['MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER'].includes(type) && (
        <View>
          <Txt title>{ar ? 'الإجابة الصحيحة والخيارات' : 'Correct answer and options'}</Txt>
          {(type === 'TRUE_FALSE'
            ? [
                { text: 'True', isCorrect: !!options[0]?.isCorrect },
                { text: 'False', isCorrect: !options[0]?.isCorrect },
              ]
            : type === 'SHORT_ANSWER'
              ? options.slice(0, 1)
              : options
          ).map((option, i) => (
            <View key={i}>
              <Field
                label={(ar ? 'الخيار ' : 'Option ') + (i + 1)}
                value={option.text}
                editable={type !== 'TRUE_FALSE'}
                onChangeText={(text) => {
                  setOptions((old) => old.map((o, n) => (n === i ? { ...o, text } : o)));
                  n.setDirty(true);
                }}
              />
              {type !== 'SHORT_ANSWER' && (
                <Button
                  secondary
                  onPress={() => {
                    setOptions((old) => old.map((o, n) => ({ ...o, isCorrect: n === i })));
                    n.setDirty(true);
                  }}
                >
                  {option.isCorrect ? '✓ ' : ''}
                  {ar ? 'الإجابة الصحيحة' : 'Correct answer'}
                </Button>
              )}
            </View>
          ))}
          {type === 'MULTIPLE_CHOICE' && (
            <Button
              secondary
              disabled={options.length >= 50}
              onPress={() => {
                setOptions([...options, { text: '', isCorrect: false }]);
                n.setDirty(true);
              }}
            >
              {ar ? 'إضافة خيار' : 'Add option'}
            </Button>
          )}
        </View>
      )}
      <Button onPress={save}>{ar ? 'حفظ' : 'Save'}</Button>
    </Card>
  );
}
