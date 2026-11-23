import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, BackHandler, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  ChildDto,
  ClassDto,
  Locale,
  MeDto,
  ParentLearningDto,
  Role,
  TokenPair,
} from '@wasl/shared';
import { catalog, rowName, type Row } from '../../../../packages/shared/src/connected';
import { text } from '../../../../packages/shared/src/demo';
import { NativeApi } from './transport';
import { Presentation } from '../presentation';

export type Route = { page: string; id?: string; edit?: boolean };
const tokenKey = 'wasl.api.tokens.v1';
const tokenVault = {
  async read(): Promise<TokenPair | null> {
    if (Platform.OS === 'web') return null;
    const raw = await SecureStore.getItemAsync(tokenKey);
    return raw ? JSON.parse(raw) : null;
  },
  async write(pair: TokenPair | null) {
    if (Platform.OS === 'web') return;
    if (pair)
      await SecureStore.setItemAsync(
        tokenKey,
        JSON.stringify({ accessToken: pair.accessToken, refreshToken: pair.refreshToken }),
      );
    else await SecureStore.deleteItemAsync(tokenKey);
  },
};
export function confirmAction(message: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm(message));
  return new Promise((resolve) =>
    Alert.alert(
      'Wasl',
      message,
      [
        { text: 'إلغاء / Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'تأكيد / Confirm', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}
const classes = (rows: ClassDto[], ar: boolean): Row[] =>
  rows.map((c) => ({
    ...c.assignment,
    title: `${ar ? c.subject.nameAr : c.subject.nameEn} · ${c.section.name} · ${c.academicYear.name}`,
    teacher: c.teacher?.fullName ?? '',
  }));
function useStateValue() {
  const [user, setUser] = useState<MeDto | null>(null);
  const [ready, setReady] = useState(false);
  const [locale, setLanguage] = useState<Locale>('ar');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [stack, setStack] = useState<Route[]>([{ page: 'dashboard' }]);
  const route = stack[stack.length - 1];
  const [child, setChild] = useState<ChildDto>();
  const [family, setFamily] = useState<ChildDto[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [record, setRecord] = useState<Row>();
  const [refs, setRefs] = useState<Record<string, Row[]>>({});
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const lock = useRef(false);
  const ar = locale === 'ar';
  const role = user?.activeRole;
  const key = route.page === 'tasks' ? 'assessments' : route.page;
  const apiRef = useRef<NativeApi | null>(null);
  if (!apiRef.current)
    apiRef.current = new NativeApi(
      process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
      tokenVault,
      () => {
        setUser(null);
        setChild(undefined);
        setRows([]);
        setRecord(undefined);
        setRefs({});
      },
    );
  const api = apiRef.current;
  const t = (key: string) => text(locale, key);
  const describe = (e: unknown) => {
    const code = (e as { status?: number }).status;
    const messages: Record<number, [string, string]> = {
      400: ['تحقق من الحقول المطلوبة.', 'Check required fields.'],
      401: ['انتهت الجلسة أو بيانات الدخول غير صحيحة.', 'Session ended or incorrect credentials.'],
      403: ['لا تملك صلاحية لهذه العملية.', 'This action is unavailable to your account.'],
      404: ['السجل غير متاح لحسابك.', 'Record unavailable to your account.'],
      409: ['تحقق من حالة السجل قبل تنفيذ العملية.', 'Check the record status before this action.'],
      413: ['الحد الأقصى للملف 10 MB.', 'Maximum file size is 10 MB.'],
    };
    return (
      messages[code ?? 0]?.[ar ? 0 : 1] ??
      (ar ? 'تعذّر الاتصال بالخدمة. أعد المحاولة.' : 'Could not reach the service. Please retry.')
    );
  };
  async function restore() {
    setError('');
    setReady(false);
    try {
      if (await api.restore()) {
        const me = await api.call<MeDto>('me');
        setUser(me);
        setStack([{ page: me.activeRole === 'PARENT' ? 'children' : 'dashboard' }]);
      }
    } catch (e) {
      setError(describe(e));
    } finally {
      setReady(true);
    }
  }
  useEffect(() => {
    void restore();
    void AsyncStorage.getItem('wasl.locale')
      .then((l) => {
        if (l === 'en') setLanguage(l);
      })
      .catch(() => undefined);
  }, []);
  async function leave() {
    return (
      !dirty ||
      (await confirmAction(
        ar ? 'عندك تغييرات غير محفوظة. مغادرة؟' : 'You have unsaved changes. Leave?',
      ))
    );
  }
  async function go(next: Route) {
    if (lock.current || !(await leave())) return;
    setDirty(false);
    setError('');
    setSuccess('');
    setStack((old) => [...old, next]);
  }
  async function back() {
    if (lock.current || !(await leave())) return;
    setDirty(false);
    setError('');
    setSuccess('');
    setStack((old) => (old.length > 1 ? old.slice(0, -1) : old));
  }
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length <= 1) return false;
      void back();
      return true;
    });
    return () => sub.remove();
  }, [stack.length, dirty]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    globalThis.addEventListener('beforeunload', handler);
    return () => globalThis.removeEventListener('beforeunload', handler);
  }, [dirty]);
  async function run<T>(
    operation: () => Promise<T>,
    done?: (value: T) => void,
    reload = true,
  ): Promise<T | undefined> {
    if (lock.current) return;
    const epoch = api.epoch;
    lock.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const value = await operation();
      if (epoch !== api.epoch) return;
      if (reload) {
        setDirty(false);
        setRevision((v) => v + 1);
      }
      setSuccess(ar ? 'تم الحفظ.' : 'Saved.');
      done?.(value);
      return value;
    } catch (e) {
      if (epoch === api.epoch) setError(describe(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function login(email: string, password: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const me = await api.login(email.trim(), password);
      setUser(me);
      setStack([{ page: me.activeRole === 'PARENT' ? 'children' : 'dashboard' }]);
      setChild(undefined);
      setDirty(false);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  async function switchContext(schoolId: string | null, role: Role, selectedChild?: ChildDto) {
    if (lock.current || !(await leave())) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setRows([]);
    setRecord(undefined);
    setRefs({});
    try {
      const me = await api.switchContext(schoolId, role);
      setUser(me);
      setChild(selectedChild);
      setStack([
        { page: selectedChild ? 'classes' : role === 'PARENT' ? 'children' : 'dashboard' },
      ]);
      setDirty(false);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  async function logout() {
    if (lock.current || !(await leave())) return;
    lock.current = true;
    setBusy(true);
    try {
      await api.logout();
      setUser(null);
      setChild(undefined);
      setRows([]);
      setRecord(undefined);
      setRefs({});
      setDirty(false);
      setSuccess('');
    } catch (e) {
      setError(describe(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function setLocale(next: Locale) {
    if (!(await leave())) return;
    setDirty(false);
    setLanguage(next);
    void AsyncStorage.setItem('wasl.locale', next).catch(() => undefined);
  }
  const principal = `${user?.id}:${user?.activeSchoolId}:${role}`;
  const scope = JSON.stringify([
    principal,
    route.page,
    route.id,
    route.edit,
    child?.link.id,
    revision,
    locale,
  ]);
  const [loadedScope, setLoadedScope] = useState('');
  useEffect(() => {
    if (!user) return;
    let active = true;
    const epoch = api.epoch;
    setLoading(true);
    setRows([]);
    setRecord(undefined);
    setRefs({});
    setError('');
    const load = async () => {
      const references: Record<string, Row[]> = {};
      let bundle: ParentLearningDto | undefined;
      if (role === 'PARENT') {
        const family = await api.all<ChildDto>('parent/children');
        if (active) setFamily(family);
        if (child) {
          if (!family.some((c) => c.link.id === child.link.id))
            throw Object.assign(new Error(), { status: 404 });
          const query = '?schoolId=' + child.school.id;
          bundle = await api.call<ParentLearningDto>(
            `parent/children/${child.student.id}/learning${query}`,
          );
          references.assignments = classes(
            (
              await api.call<{ classes: ClassDto[] }>(
                `parent/children/${child.student.id}/overview${query}`,
              )
            ).classes,
            ar,
          );
          references.units = bundle.units as unknown as Row[];
          references.lessons = bundle.lessons as unknown as Row[];
        }
      } else if (role === 'TEACHER' || role === 'STUDENT')
        references.assignments = classes(await api.all<ClassDto>('me/classes'), ar);
      if (role === 'TEACHER' && ['submissions', 'gradebook'].includes(key)) {
        const students: Row[] = [];
        for (const c of references.assignments ?? []) {
          const roster = await api.all<{ student: { id: string; fullName: string } }>(
            'teacher/classes/' + c.id + '/roster',
          );
          students.push(...roster.map((r) => ({ ...r.student })));
        }
        references.students = [...new Map(students.map((s) => [s.id, s])).values()];
      } else if (role === 'STUDENT')
        references.students = [{ id: user.id, fullName: user.fullName }];
      const sources = new Set(
        catalog[key]?.fields.flatMap((f) => (f.source ? [f.source] : [])) ?? [],
      );
      if (key === 'questions') sources.add('banks');
      if (['submissions', 'gradebook'].includes(key)) sources.add('assessments');
      if (['memberships', 'links', 'enrollments'].includes(key)) sources.add('users');
      for (const source of sources) {
        if (references[source] || role === 'PARENT') continue;
        const type = (
          { teachers: 'TEACHER', students: 'STUDENT', parents: 'PARENT' } as Record<string, string>
        )[source];
        if (type) references[source] = await api.all<Row>('users?role=' + type);
        else if (catalog[source]) references[source] = await api.all<Row>(catalog[source].path);
      }
      if (['dashboard', 'academics', 'children', 'profile', 'more'].includes(key))
        return { references, data: [] };
      if (role === 'PARENT' && !child && key !== 'notifications') return { references, data: [] };
      if (key === 'classes') {
        if (role === 'SCHOOL_ADMIN')
          references.assignments = classes(
            (await api.call<{ classes: ClassDto[] }>('school/academic-overview')).classes,
            ar,
          );
        return { references, data: references.assignments ?? [] };
      }
      if (key === 'results') {
        const results = await api.all<{ id: string; assessment: Row; submission: Row }>(
          role === 'PARENT'
            ? `parent/children/${child!.student.id}/grades?schoolId=${child!.school.id}`
            : 'me/grades',
        );
        const data = results.map((r) => ({
          ...r.submission,
          title: r.assessment.title,
          totalPoints: r.assessment.totalPoints,
        }));
        return { references, data, row: data.find((r) => r.id === route.id) };
      }
      if (['submissions', 'gradebook'].includes(key)) {
        if (route.id)
          return { references, data: [], row: await api.call<Row>('submissions/' + route.id) };
        const data: Row[] = [];
        for (const assessment of references.assessments ?? []) {
          if (role === 'STUDENT') {
            try {
              data.push(await api.call<Row>(`assessments/${assessment.id}/submission`));
            } catch (e) {
              if ((e as { status?: number }).status !== 404) throw e;
            }
          } else data.push(...(await api.all<Row>(`assessments/${assessment.id}/submissions`)));
        }
        return { references, data };
      }
      if (bundle && ['lessons', 'resources', 'announcements', 'assessments'].includes(key)) {
        const data = bundle[
          key as 'lessons' | 'resources' | 'announcements' | 'assessments'
        ] as unknown as Row[];
        const row =
          key === 'assessments' && route.id
            ? await api.call<Row>(
                `parent/children/${child!.student.id}/assessments/${route.id}?schoolId=${child!.school.id}`,
              )
            : data.find((r) => r.id === route.id);
        if (route.id && !row) throw Object.assign(new Error(), { status: 404 });
        return { references, data, row };
      }
      const config = catalog[key];
      if (!config) throw Object.assign(new Error(), { status: 404 });
      if (route.id === 'new') return { references, data: [] };
      if (route.id)
        return { references, data: [], row: await api.call<Row>(config.path + '/' + route.id) };
      if (key === 'questions') {
        const data: Row[] = [];
        for (const bank of references.banks ?? [])
          data.push(...(await api.all<Row>(`question-banks/${bank.id}/questions`)));
        return { references, data };
      }
      return { references, data: await api.all<Row>(config.path) };
    };
    void load()
      .then((value) => {
        if (active && epoch === api.epoch) {
          setRefs(value.references);
          setRows(value.data);
          setRecord(value.row);
        }
      })
      .catch((e) => {
        if (active && epoch === api.epoch) setError(describe(e));
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
  }, [principal, route.page, route.id, route.edit, child?.link.id, revision, locale]);
  const saved = (next: Route) => {
    setDirty(false);
    setStack((old) => [...old.slice(0, -1), next]);
  };
  const display = (row: Row, field: string) => {
    const value = row[field];
    const source = (
      {
        sectionSubjectId: 'assignments',
        assessmentId: 'assessments',
        unitId: 'units',
        lessonId: 'lessons',
        studentId: 'students',
        parentId: 'parents',
        userId: 'users',
        teacherId: 'teachers',
        sectionId: 'sections',
        gradeId: 'grades',
        subjectId: 'subjects',
        academicYearId: 'years',
      } as Record<string, string>
    )[field];
    const reference = (refs[source] ?? refs.users)?.find((r) => r.id === value);
    return reference ? rowName(reference, ar) : value;
  };
  return {
    api,
    user,
    ready,
    locale,
    ar,
    role,
    t,
    busy,
    error,
    success,
    route,
    key,
    child,
    family,
    rows,
    record,
    refs,
    loading: loading || loadedScope !== scope,
    dirty,
    setDirty,
    setError,
    setUser,
    login,
    logout,
    switchContext,
    go,
    back,
    setLocale,
    run,
    restore,
    saved,
    display,
    refresh: () => setRevision((v) => v + 1),
  };
}
const Context = createContext<ReturnType<typeof useStateValue> | null>(null);
export function ConnectedProvider({ children }: { children: ReactNode }) {
  const value = useStateValue();
  return (
    <Context.Provider value={value}>
      <Presentation.Provider value={value}>{children}</Presentation.Provider>
    </Context.Provider>
  );
}
export function useConnected() {
  const value = useContext(Context);
  if (!value) throw new Error('ConnectedProvider required');
  return value;
}
