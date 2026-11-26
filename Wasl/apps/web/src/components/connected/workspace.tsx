'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ChildDto, ClassDto, Page, ParentFileContext, ParentLearningDto, Role } from '@wasl/shared';
import { catalog, academics, roleNav, rowName, word, type Row } from '@/lib/connected/catalog';
import { all, api, errorText } from '@/lib/connected/http';
import { client, home, useApiSession } from './session';
import { ApiRecordForm } from './record-form';
import { AssessmentPanel, SubmissionPanel } from './workflows';
import { EducationArt, EducationBackground, NavigationIcon } from '../education';

export type Run = <T>(work: () => Promise<T>, done?: (value: T) => void) => Promise<T | undefined>;
const expected: Record<string, Role> = {
  admin: 'PLATFORM_ADMIN',
  school: 'SCHOOL_ADMIN',
  teacher: 'TEACHER',
  student: 'STUDENT',
  parent: 'PARENT',
};
const asRow = (v: object) => v as Row;
const classRows = (classes: ClassDto[], ar: boolean): Row[] =>
  classes.map((c) => ({
    ...c.assignment,
    title: `${ar ? c.subject.nameAr : c.subject.nameEn} · ${c.section.name} · ${c.academicYear.name}`,
    teacher: c.teacher?.fullName ?? '',
    classInfo: c,
  }));
export function ApiWorkspace({ role, path = [] }: { role: string; path?: string[] }) {
  return (
    <Suspense fallback={<p role="status">جاري التحميل / Loading</p>}>
      <ConnectedScreen role={role} path={path} />
    </Suspense>
  );
}
function ConnectedScreen({ role, path }: { role: string; path: string[] }) {
  const s = useApiSession();
  const ar = s.locale === 'ar';
  const router = useRouter();
  const search = useSearchParams();
  const pathname = usePathname();
  const page =
    path[0] ?? (role === 'admin' ? 'dashboard' : role === 'parent' ? 'children' : 'dashboard');
  const key = page === 'tasks' ? 'assessments' : page;
  const definition = catalog[key];
  const id = path[1] && path[1] !== 'new' ? path[1] : undefined;
  const editing = path[1] === 'new' || path[2] === 'edit';
  const child = search.get('child') ?? '';
  const school = search.get('school') ?? '';
  const bank = search.get('bank') ?? '';
  const [rows, setRows] = useState<Row[]>([]);
  const [record, setRecord] = useState<Row>();
  const [total, setTotal] = useState(0);
  const [references, setReferences] = useState<Record<string, Row[]>>({});
  const [children, setChildren] = useState<ChildDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const lock = useRef(false);
  const operation = useRef(0);
  const [version, setVersion] = useState(0);
  const [query, setQuery] = useState('');
  const [listPage, setListPage] = useState(1);
  const [selectedBank, setSelectedBank] = useState(bank);
  const href = (p: string, recordId?: string, edit = false) =>
    `/${role}/${p}${recordId ? '/' + recordId : ''}${edit ? '/edit' : ''}${child ? '?child=' + encodeURIComponent(child) + '&school=' + encodeURIComponent(school) : ''}`;
  const can = s.user?.activeRole === expected[role];
  const principal = `${s.user?.id}:${s.user?.activeSchoolId}:${s.user?.activeRole}`;
  const scope = JSON.stringify([
    principal,
    role,
    page,
    id,
    editing,
    child,
    school,
    selectedBank,
    bank,
    listPage,
    query,
    version,
    ar,
  ]);
  const [loadedScope, setLoadedScope] = useState('');
  useEffect(() => {
    if (s.ready && !s.user) router.replace('/login');
  }, [s.ready, s.user, router]);
  useEffect(() => {
    setQuery('');
    setListPage(1);
    setNotice('');
    setError('');
    setDirty(false);
    setRows([]);
    setRecord(undefined);
  }, [pathname, child, principal]);
  useEffect(() => {
    const listener = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [dirty]);
  const run: Run = async (work, done) => {
    if (lock.current) return;
    const epoch = s.generation.current;
    const serial = ++operation.current;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const value = await work();
      if (epoch !== s.generation.current) return;
      setDirty(false);
      setNotice(ar ? 'تم الحفظ.' : 'Saved.');
      done?.(value);
      setVersion((v) => v + 1);
      return value;
    } catch (e) {
      if (epoch === s.generation.current) {
        setError(errorText(e, ar));
        if ((e as { status?: number }).status === 401) void s.refresh();
      }
    } finally {
      if (serial === operation.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  };
  useEffect(() => {
    if (!s.ready || !s.user || !can) {
      setLoading(false);
      return;
    }
    if (role === 'parent' && child && school && school !== s.user.activeSchoolId) {
      if (!s.user.memberships.some((m) => m.schoolId === school && m.role === 'PARENT')) {
        setError(ar ? 'هذا الطفل غير متاح لحسابك.' : 'This child is unavailable to your account.');
        setLoading(false);
        return;
      }
      void s.switchContext(school, 'PARENT', pathname + '?' + search.toString());
      return;
    }
    let active = true;
    const epoch = s.generation.current;
    setLoading(true);
    setError('');
    setRecord(undefined);
    setRows([]);
    setReferences({});
    const load = async () => {
      const refs: Record<string, Row[]> = {};
      let family: ChildDto[] = [];
      let bundle: ParentLearningDto | undefined;
      if (role === 'parent') {
        family = await all<ChildDto>('parent/children');
        if (active) setChildren(family);
        if (child && !family.some((c) => c.student.id === child && c.school.id === school))
          throw Object.assign(new Error('Unavailable child'), { status: 404 });
        if (child) {
          bundle = await client.childLearning(child, school);
          const overview = await client.childOverview(child, school);
          refs.assignments = classRows(overview.classes, ar);
          refs.units = bundle.units.map(asRow);
          refs.lessons = bundle.lessons.map(asRow);
        }
      }
      if (role === 'teacher' || role === 'student')
        refs.assignments = classRows(await all<ClassDto>('me/classes'), ar);
      if (role === 'teacher' && ['submissions', 'gradebook'].includes(page)) {
        const students: Row[] = [];
        for (const c of refs.assignments ?? []) {
          const roster = await all<{ student: { id: string; fullName: string } }>(
            'teacher/classes/' + c.id + '/roster',
          );
          students.push(...roster.map((r) => ({ ...r.student })));
        }
        refs.students = [...new Map(students.map((r) => [r.id, r])).values()];
      }
      const sources = new Set(
        definition?.fields.flatMap((f) => (f.source ? [f.source] : [])) ?? [],
      );
      if (page === 'questions') sources.add('banks');
      if (page === 'memberships' || page === 'links' || page === 'enrollments')
        sources.add('users');
      if (page === 'submissions' || page === 'gradebook' || page === 'results')
        sources.add('assessments');
      for (const source of sources) {
        if (refs[source]) continue;
        if (['teachers', 'students', 'parents'].includes(source)) {
          refs[source] = await all<Row>(
            'users?role=' + { teachers: 'TEACHER', students: 'STUDENT', parents: 'PARENT' }[source],
          );
          continue;
        }
        if (role === 'parent') continue;
        const config = catalog[source];
        if (config) refs[source] = await all<Row>(config.path);
      }
      if (page === 'profile' || page === 'settings')
        return { refs, data: [asRow(s.user!)], total: 1 };
      if (page === 'children')
        return {
          refs,
          data: family.map((c) => ({
            id: c.student.id,
            fullName: c.student.fullName,
            school: c.school.nameAr || c.school.name,
            childInfo: c,
          })),
          total: family.length,
        };
      if (role === 'parent' && !child && !['notifications', 'profile', 'children'].includes(page))
        return { refs, data: [], total: 0 };
      if (page === 'dashboard') {
        const data =
          role === 'admin'
            ? await all<Row>('admin/schools')
            : role === 'school'
              ? classRows((await client.schoolOverview()).classes, ar)
              : (refs.assignments ?? []);
        return { refs, data, total: data.length };
      }
      if (page === 'classes')
        return { refs, data: refs.assignments ?? [], total: refs.assignments?.length ?? 0 };
      if (page === 'academics') return { refs, data: [], total: 0 };
      if (page === 'submissions' || page === 'gradebook') {
        const assessments = refs.assessments ?? [];
        if (id) {
          const row = await api<Row>('submissions/' + encodeURIComponent(id));
          return { refs, data: [], total: 0, row };
        }
        const data: Row[] = [];
        for (const a of assessments) {
          if (role === 'student') {
            try {
              data.push(await api<Row>('assessments/' + a.id + '/submission'));
            } catch (e) {
              if ((e as { status?: number }).status !== 404) throw e;
            }
          } else data.push(...(await all<Row>('assessments/' + a.id + '/submissions')));
        }
        return { refs, data, total: data.length };
      }
      if (page === 'results') {
        if (id) {
          if (role === 'parent') {
            const results = await all<{ id: string; assessment: Row; submission: Row }>(
              'parent/children/' + child + '/grades?schoolId=' + school,
            );
            const result = results.find((r) => r.id === id);
            if (!result) throw Object.assign(new Error('Unavailable result'), { status: 404 });
            return {
              refs,
              data: [],
              total: 0,
              row: {
                ...result.submission,
                title: result.assessment.title,
                totalPoints: result.assessment.totalPoints,
              },
            };
          }
          const submission = await api<Row>('submissions/' + id);
          if (!submission.resultsReleased)
            throw Object.assign(new Error('Unavailable result'), { status: 404 });
          return { refs, data: [], total: 0, row: submission };
        }
        const result =
          role === 'parent'
            ? await client.childGrades(child, {
                schoolId: school,
                page: listPage,
                limit: 20,
                search: query,
              })
            : await client.myGrades({ page: listPage, limit: 20, search: query });
        const data = result.items.map((r) => ({
          ...r.submission,
          title: r.assessment.title,
          totalPoints: r.assessment.totalPoints,
          assessmentInfo: r.assessment,
        }));
        return {
          refs,
          data,
          total: result.total,
          row: id ? data.find((r) => r.id === id) : undefined,
        };
      }
      if (!definition) throw Object.assign(new Error('Unavailable page'), { status: 404 });
      if (
        role === 'parent' &&
        bundle &&
        ['lessons', 'resources', 'announcements', 'tasks', 'assessments'].includes(page)
      ) {
        const data = (page === 'tasks'
          ? bundle.assessments
          : bundle[
              page as 'lessons' | 'resources' | 'announcements' | 'assessments'
            ]) as unknown as Row[];
        const row = id
          ? key === 'assessments'
            ? await client.childAssessment(child, id, school)
            : data.find((r) => r.id === id)
          : undefined;
        if (id && !row) throw Object.assign(new Error('Unavailable record'), { status: 404 });
        return { refs, data, row: row as Row | undefined, total: data.length };
      }
      if (editing && !id) return { refs, data: [], total: 0 };
      if (id)
        return {
          refs,
          data: [],
          total: 0,
          row: await api<Row>(definition.path + '/' + encodeURIComponent(id)),
        };
      const bankId = selectedBank || bank || refs.banks?.[0]?.id;
      if (key === 'questions' && !bankId) return { refs, data: [], total: 0 };
      const path =
        key === 'questions'
          ? 'question-banks/' + encodeURIComponent(bankId!) + '/questions'
          : definition.path;
      const response = await api<Page<Row>>(
        path + `?page=${listPage}&limit=20&search=${encodeURIComponent(query)}`,
      );
      return { refs, data: response.items, total: response.total };
    };
    void load()
      .then((value) => {
        if (active && epoch === s.generation.current) {
          setRows(value.data);
          setRecord(value.row);
          setReferences(value.refs);
          setTotal(value.total);
        }
      })
      .catch((e) => {
        if (active && epoch === s.generation.current) {
          setError(errorText(e, ar));
          if ((e as { status?: number }).status === 401) void s.refresh();
        }
      })
      .finally(() => {
        if (active) {
          setLoadedScope(scope);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
    // Search is intentionally sent to the API; no saved demo snapshot participates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    s.ready,
    principal,
    can,
    role,
    page,
    id,
    editing,
    child,
    school,
    selectedBank,
    bank,
    listPage,
    query,
    version,
    ar,
  ]);
  const confirm = (message: string) => window.confirm(message);
  const safeLeave = () =>
    !dirty ||
    confirm(
      ar
        ? 'عندك تغييرات غير محفوظة. هل تريد المغادرة؟'
        : 'You have unsaved changes. Leave this page?',
    );
  const selectedName = children.find((c) => c.student.id === child)?.student.fullName;
  const value = (row: Row, column: string): ReactNode => {
    const raw = row[column];
    if (typeof raw === 'boolean') return raw ? (ar ? 'نعم' : 'Yes') : ar ? 'لا' : 'No';
    if (raw === null || raw === undefined || raw === '') return '—';
    const sources: Record<string, string> = {
      userId: 'users',
      studentId: 'students',
      parentId: 'parents',
      teacherId: 'teachers',
      academicYearId: 'years',
      gradeId: 'grades',
      sectionId: 'sections',
      subjectId: 'subjects',
      unitId: 'units',
      lessonId: 'lessons',
      sectionSubjectId: 'assignments',
      assessmentId: 'assessments',
      questionBankId: 'banks',
    };
    const ref = (references[sources[column]] ?? references.users)?.find((r) => r.id === raw);
    if (ref) return rowName(ref, ar);
    if (column === 'title' && ar && row.titleAr) return String(row.titleAr);
    return word(String(raw), ar);
  };
  const download = async (storageKey: string, context?: ParentFileContext) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const f = await client.resolveFile(storageKey, context);
      const blob = await client.downloadFile(f.id, context);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = f.originalName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setError(errorText(e, ar));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const action = (path: string, method = 'POST', body?: object) => {
    if (confirm(ar ? 'تأكيد تنفيذ العملية؟' : 'Confirm this action?'))
      void run(() => api(path, method, body));
  };
  const content = () => {
    if (!s.ready || loading || (can && loadedScope !== scope))
      return <p role="status">{ar ? 'جاري التحميل...' : 'Loading...'}</p>;
    if (!s.user) return null;
    if (!can)
      return (
        <p>
          <Link href={home(s.user.activeRole)}>
            {ar ? 'العودة إلى مساحة حسابك' : 'Go to your account workspace'}
          </Link>
        </p>
      );
    if (page === 'profile' || page === 'settings')
      return <Profile run={run} busy={busy} dirty={() => setDirty(true)} />;
    if (page === 'academics')
      return (
        <div className="learning-cards">
          {academics.map((k) => (
            <Link className="panel learning-card" href={href(k)} key={k}>
              <h2>{word(k, ar)}</h2>
            </Link>
          ))}
        </div>
      );
    if (role === 'parent' && !child && !['children', 'notifications'].includes(page))
      return (
        <div className="panel">
          <p>{ar ? 'اختر أحد أبنائك لعرض محتواه.' : 'Choose a child to view their learning.'}</p>
          <Link className="button" href="/parent/children">
            {word('children', ar)}
          </Link>
        </div>
      );
    if (page === 'dashboard')
      return (
        <>
          <section className="panel">
            <EducationArt theme="entry" />
            <h2>
              {ar ? 'أهلًا، ' : 'Welcome, '}
              {s.user.fullName}
            </h2>
            <p>
              {ar
                ? 'تابع نشاطك الدراسي من الأقسام التالية.'
                : 'Follow your learning activity using the sections below.'}
            </p>
          </section>
          <div className="learning-cards">
            {roleNav[s.user.activeRole!]
              .filter((k) => !['dashboard', 'profile'].includes(k))
              .map((k) => (
                <Link key={k} href={href(k)} className="panel learning-card">
                  <NavigationIcon page={k} />
                  <h2>{word(k, ar)}</h2>
                </Link>
              ))}
          </div>
        </>
      );
    if (page === 'children')
      return (
        <div className="learning-cards">
          {children.map((c) => (
            <article className="panel learning-card" key={c.link.id}>
              <EducationArt subject="" />
              <h2>{c.student.fullName}</h2>
              <p>{ar ? c.school.nameAr || c.school.name : c.school.name}</p>
              <Link
                className="button"
                href={`/parent/classes?child=${c.student.id}&school=${c.school.id}`}
              >
                {ar ? 'عرض التعلم' : 'View learning'}
              </Link>
            </article>
          ))}
          {!children.length && (
            <p>
              {ar
                ? 'لا يوجد أطفال مرتبطون ومصرّح لهم حاليًا.'
                : 'There are no currently approved child links.'}
            </p>
          )}
        </div>
      );
    if (editing && definition) {
      if (!definition[rowId() ? 'edit' : 'create']?.includes(s.user.activeRole!))
        return (
          <p>
            {ar ? 'هذه العملية غير متاحة لحسابك.' : 'This action is unavailable to your account.'}
          </p>
        );
      if (id && !record) return null;
      return (
        <ApiRecordForm
          key={principal + ':' + pathname}
          definition={definition}
          row={record}
          references={references}
          busy={busy}
          dirty={() => setDirty(true)}
          submit={(work) => {
            void run(work, (result) => router.push(href(key, result.id)));
          }}
        />
      );
    }
    if (id && record) {
      if (key === 'assessments')
        return (
          <AssessmentPanel
            row={record}
            role={s.user.activeRole!}
            run={run}
            busy={busy}
            dirty={() => setDirty(true)}
            download={download}
          />
        );
      if (page === 'submissions' || page === 'results')
        return (
          <SubmissionPanel
            row={record}
            role={s.user.activeRole!}
            run={run}
            busy={busy}
            dirty={() => setDirty(true)}
            download={download}
            child={child}
            school={school}
          />
        );
      return (
        <section className="panel profile-panel">
          <h2>{rowName(record, ar)}</h2>
          <div className="actions">
            {definition?.edit?.includes(s.user.activeRole!) &&
              (!record.status || record.status === 'DRAFT') && (
                <Link className="button secondary" href={href(key, id, true)}>
                  {ar ? 'تعديل' : 'Edit'}
                </Link>
              )}
            {actions(record)}
          </div>
          <dl className="definition-list">
            {(definition?.columns ?? []).map((c) => (
              <div key={c}>
                <dt>{word(c, ar)}</dt>
                <dd>{value(record, c)}</dd>
              </div>
            ))}
          </dl>
          {typeof record.body === 'string' && <p className="long-content">{record.body}</p>}
          {record.type === 'FILE' && typeof record.storageKey === 'string' && (
            <button
              className="button"
              disabled={busy}
              onClick={() => void download(record.storageKey as string,
                role === 'parent' && child && school ? { studentId: child, schoolId: school } : undefined)}
            >
              {ar ? 'تنزيل الملف' : 'Download file'}
            </button>
          )}
          {typeof record.url === 'string' && /^https:\/\//.test(record.url) && (
            <a href={record.url} target="_blank" rel="noreferrer" className="button secondary">
              {ar ? 'فتح الرابط' : 'Open link'}
            </a>
          )}
          {key === 'schools' && s.user.activeRole === 'PLATFORM_ADMIN' && (
            <ProvisionAdministrator schoolId={id} run={run} busy={busy} />
          )}
          {key === 'lessons' && (
            <Link className="button secondary" href={href('resources')}>
              {word('resources', ar)}
            </Link>
          )}
          {key === 'banks' && (
            <Link className="button secondary" href={href('questions') + '?bank=' + id}>
              {word('questions', ar)}
            </Link>
          )}
        </section>
      );
    }
    const columns =
      page === 'classes'
        ? ['title', 'teacher']
        : page === 'submissions' || page === 'gradebook'
          ? ['studentId', 'assessmentId', 'status', 'submittedAt', 'score']
          : page === 'results'
            ? ['title', 'score', 'totalPoints']
            : (definition?.columns ?? ['title']);
    return (
      <>
        <div className="toolbar panel">
          <label>
            {ar ? 'بحث' : 'Search'}
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setListPage(1);
              }}
            />
          </label>
          {definition?.create?.includes(s.user.activeRole!) && (
            <Link className="button" href={href(key, 'new')}>
              {ar ? 'إضافة' : 'Add'} · {word(key, ar)}
            </Link>
          )}
          {key === 'questions' && (
            <label>
              {word('banks', ar)}
              <select
                value={selectedBank || bank || references.banks?.[0]?.id || ''}
                onChange={(e) => {
                  setSelectedBank(e.target.value);
                  setListPage(1);
                }}
              >
                {references.banks?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {rowName(b, ar)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {key === 'notifications' && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void run(() => client.readAllNotifications())}
            >
              {ar ? 'تعليم الكل كمقروء' : 'Mark all read'}
            </button>
          )}
        </div>
        {!rows.length ? (
          <section className="panel empty">
            <EducationArt subject="" />
            <h2>{ar ? 'لا توجد سجلات لعرضها' : 'No records to display'}</h2>
          </section>
        ) : (
          <div className="panel table-scroll">
            <table>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c}>{word(c, ar)}</th>
                  ))}
                  <th>{ar ? 'الإجراءات' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter(
                    (r) =>
                      !['classes', 'submissions', 'gradebook'].includes(page) ||
                      !query ||
                      Object.values(r)
                        .filter((v) => typeof v === 'string')
                        .join(' ')
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                  )
                  .map((r) => (
                    <tr key={r.id}>
                      {columns.map((c) => (
                        <td key={c}>{value(r, c)}</td>
                      ))}
                      <td>
                        <div className="actions">
                          {page !== 'classes' && (
                            <Link
                              className="text-link"
                              href={href(page === 'gradebook' ? 'submissions' : key, r.id)}
                            >
                              {ar ? 'عرض' : 'View'}
                            </Link>
                          )}
                          {actions(r)}
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        {!['classes', 'submissions', 'gradebook'].includes(page) && (
          <div className="pagination">
            <button
              className="button secondary"
              disabled={listPage <= 1 || loading}
              onClick={() => setListPage((p) => p - 1)}
            >
              {ar ? 'السابق' : 'Previous'}
            </button>
            <span>
              {listPage} · {total}
            </span>
            <button
              className="button secondary"
              disabled={listPage * 20 >= total || loading}
              onClick={() => setListPage((p) => p + 1)}
            >
              {ar ? 'التالي' : 'Next'}
            </button>
          </div>
        )}
      </>
    );
  };
  function rowId() {
    return id;
  }
  function actions(row: Row) {
    if (!s.user) return null;
    const roleName = s.user.activeRole;
    if (key === 'notifications')
      return (
        !row.readAt && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void run(() => client.readNotification(row.id))}
          >
            {ar ? 'تعليم كمقروء' : 'Mark read'}
          </button>
        )
      );
    if (roleName === 'PLATFORM_ADMIN' && key === 'schools')
      return (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => action(`admin/schools/${row.id}`, 'PATCH', { active: !row.active })}
        >
          {row.active ? (ar ? 'تعليق' : 'Suspend') : ar ? 'إعادة تفعيل' : 'Reactivate'}
        </button>
      );
    if (roleName === 'SCHOOL_ADMIN' && key === 'memberships')
      return (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => action(`memberships/${row.id}`, 'PATCH', { active: !row.active })}
        >
          {row.active ? (ar ? 'تعطيل' : 'Deactivate') : ar ? 'تفعيل' : 'Activate'}
        </button>
      );
    if (roleName === 'SCHOOL_ADMIN' && key === 'years')
      return (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => action(`academic-years/${row.id}`, 'PATCH', { archived: !row.archived })}
        >
          {row.archived ? (ar ? 'إلغاء الأرشفة' : 'Unarchive') : ar ? 'أرشفة' : 'Archive'}
        </button>
      );
    if (roleName === 'SCHOOL_ADMIN' && key === 'links')
      return (
        <>
          {row.status !== 'VERIFIED' && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => action(`parent-links/${row.id}`, 'PATCH', { status: 'VERIFIED' })}
            >
              {ar ? 'توثيق' : 'Verify'}
            </button>
          )}
          {row.status !== 'REJECTED' && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => action(`parent-links/${row.id}`, 'PATCH', { status: 'REJECTED' })}
            >
              {ar ? 'إلغاء الوصول' : 'Revoke access'}
            </button>
          )}
        </>
      );
    if (key === 'lessons' && roleName === 'TEACHER')
      return row.status === 'DRAFT' || row.status === 'PUBLISHED' ? (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() =>
            action(`lessons/${row.id}`, 'PATCH', {
              status: row.status === 'DRAFT' ? 'PUBLISHED' : 'ARCHIVED',
            })
          }
        >
          {row.status === 'DRAFT' ? (ar ? 'نشر' : 'Publish') : ar ? 'أرشفة' : 'Archive'}
        </button>
      ) : null;
    if (
      key === 'announcements' &&
      ['TEACHER', 'SCHOOL_ADMIN'].includes(roleName ?? '') &&
      (row.status === 'DRAFT' || row.status === 'PUBLISHED')
    )
      return (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() =>
            action(`announcements/${row.id}/${row.status === 'DRAFT' ? 'publish' : 'archive'}`)
          }
        >
          {row.status === 'DRAFT' ? (ar ? 'نشر' : 'Publish') : ar ? 'أرشفة' : 'Archive'}
        </button>
      );
    return null;
  }
  return (
    <div
      className="admin-shell connected-workspace"
      onClickCapture={(e) => {
        const a = e.target instanceof Element ? e.target.closest('a') : null;
        if (a?.getAttribute('href')?.startsWith('/') && !e.metaKey && !e.ctrlKey && !safeLeave()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <a className="skip-link" href="#workspace-main">
        {ar ? 'تخطّي إلى المحتوى' : 'Skip to content'}
      </a>
      <aside className="sidebar">
        <Link className="brand" href={home(s.user?.activeRole)}>
          <span className="brand-symbol">و</span>
          <span>{ar ? 'وصل' : 'Wasl'}</span>
        </Link>
        <div className="sidebar-workspace">{word(s.user?.activeRole ?? '', ar)}</div>
        <nav>
          {s.user?.activeRole &&
            roleNav[s.user.activeRole].map((p) => (
              <Link
                className={'nav-link ' + (page === p ? 'selected' : '')}
                key={p}
                href={href(p)}
                aria-current={page === p ? 'page' : undefined}
              >
                <NavigationIcon page={p} />
                {word(p, ar)}
              </Link>
            ))}
        </nav>
      </aside>
      <main className="admin-main" id="workspace-main">
        <EducationBackground />
        <header className="topbar">
          <strong>{s.user?.fullName}</strong>
          <div className="actions">
            {s.user?.activeRole && (
              <label className="live-mobile-nav">
                {ar ? 'انتقل إلى' : 'Navigate'}
                <select
                  aria-label={ar ? 'انتقل إلى' : 'Navigate'}
                  value={
                    roleNav[s.user.activeRole].includes(page)
                      ? page
                      : academics.includes(page)
                        ? 'academics'
                        : key === 'assessments' && role === 'student'
                          ? 'tasks'
                          : 'dashboard'
                  }
                  onChange={(e) => {
                    if (safeLeave()) router.push(href(e.target.value));
                  }}
                >
                  {roleNav[s.user.activeRole].map((p) => (
                    <option key={p} value={p}>
                      {word(p, ar)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <select
              aria-label={ar ? 'المدرسة والدور' : 'School and role'}
              disabled={s.busy}
              value={JSON.stringify({
                schoolId: s.user?.activeSchoolId ?? null,
                role: s.user?.activeRole,
              })}
              onChange={(e) => {
                if (safeLeave()) {
                  const v = JSON.parse(e.target.value) as { schoolId: string | null; role: Role };
                  void s.switchContext(v.schoolId, v.role);
                }
              }}
            >
              {s.user?.memberships.map((m) => (
                <option
                  key={`${m.schoolId}:${m.role}`}
                  value={JSON.stringify({ schoolId: m.schoolId, role: m.role })}
                >
                  {m.schoolName || (ar ? 'المنصة' : 'Platform')} · {word(m.role, ar)}
                </option>
              ))}
            </select>
            <div className="language-switch">
              <button
                onClick={() => {
                  if (safeLeave()) s.setLocale('ar');
                }}
              >
                عربي
              </button>
              <button
                onClick={() => {
                  if (safeLeave()) s.setLocale('en');
                }}
              >
                English
              </button>
            </div>
            <button
              className="button secondary"
              disabled={s.busy}
              onClick={() => {
                if (safeLeave()) void s.logout();
              }}
            >
              {ar ? 'خروج' : 'Sign out'}
            </button>
          </div>
        </header>
        <div className="workspace-content">
          <header className="page-heading">
            <h1>
              {word(page, ar)}
              {selectedName ? ' · ' + selectedName : ''}
            </h1>
            {id && (
              <Link className="text-link" href={href(page)}>
                {ar ? 'رجوع' : 'Back'}
              </Link>
            )}
          </header>
          {role === 'parent' && page !== 'children' && children.length > 0 && (
            <label className="panel">
              {ar ? 'الطفل' : 'Child'}
              <select
                value={`${child}:${school}`}
                onChange={(e) => {
                  if (safeLeave()) {
                    const c = children.find(
                      (c) => `${c.student.id}:${c.school.id}` === e.target.value,
                    );
                    if (c)
                      router.push(`/${role}/${page}?child=${c.student.id}&school=${c.school.id}`);
                  }
                }}
              >
                <option value=":">{ar ? 'اختر طفلًا' : 'Choose a child'}</option>
                {children.map((c) => (
                  <option key={c.link.id} value={`${c.student.id}:${c.school.id}`}>
                    {c.student.fullName} · {c.school.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(error || s.error) && (
            <p className="form-alert" role="alert">
              {error ||
                (ar
                  ? 'تعذّر تحديث الجلسة. حاول مرة أخرى.'
                  : 'Could not update the session. Please retry.')}{' '}
              <button
                className="button secondary"
                onClick={() => {
                  setVersion((v) => v + 1);
                  void s.refresh();
                }}
              >
                {ar ? 'إعادة المحاولة' : 'Retry'}
              </button>
            </p>
          )}
          {notice && (
            <p className="banner" role="status">
              {notice}
            </p>
          )}
          {content()}
        </div>
      </main>
    </div>
  );
}
function Profile({ run, busy, dirty }: { run: Run; busy: boolean; dirty: () => void }) {
  const s = useApiSession();
  const ar = s.locale === 'ar';
  const [name, setName] = useState(s.user?.fullName ?? '');
  return (
    <form
      className="panel form-panel"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          () => client.updateProfile({ fullName: name }),
          () => {
            void s.refresh();
          },
        );
      }}
    >
      <label>
        {ar ? 'الاسم الكامل' : 'Full name'}
        <input
          required
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            dirty();
          }}
        />
      </label>
      <label>
        {ar ? 'البريد الإلكتروني' : 'Email'}
        <input value={s.user?.email ?? ''} readOnly dir="ltr" />
      </label>
      <button className="button" disabled={busy}>
        {ar ? 'حفظ' : 'Save'}
      </button>
    </form>
  );
}
function ProvisionAdministrator({
  schoolId,
  run,
  busy,
}: {
  schoolId: string;
  run: Run;
  busy: boolean;
}) {
  const s = useApiSession();
  const ar = s.locale === 'ar';
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  return (
    <form
      className="panel form-panel"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          () =>
            client.provisionSchoolAdministrator(schoolId, {
              email,
              ...(name ? { fullName: name } : {}),
              ...(password ? { password } : {}),
            }),
          () => {
            setPassword('');
          },
        );
      }}
    >
      <h3>{ar ? 'تعيين مدير المدرسة' : 'Provision school administrator'}</h3>
      <label>
        {ar ? 'البريد الإلكتروني' : 'Email'}
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        {ar ? 'الاسم (لحساب جديد)' : 'Name (new account)'}
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        {ar ? 'كلمة المرور الأولية (لحساب جديد)' : 'Initial password (new account)'}
        <input
          type="password"
          minLength={12}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <button className="button" disabled={busy}>
        {ar ? 'تعيين المدير' : 'Assign administrator'}
      </button>
    </form>
  );
}
