import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { MeDto } from '@wasl/shared';
import {
  academics,
  catalog,
  roleNav,
  rowName,
  word,
  type Row,
} from '../../../../packages/shared/src/connected';
import { Button, Card, Field, Select, Txt, styles } from '../ui';
import { NativeEducationArt, NativeEducationBackground, NativeQuickActions, NativeWelcome } from '../education';
import { BottomInset, HeaderPill, ScreenTransition, ShellHeader, TabBar } from '../shell';
import { Gradient, RoleThemeProvider } from '../theme';
import { initials, paletteFor } from '../../../../packages/shared/src/demo';
import { ConnectedProvider, confirmAction, useConnected } from './context';
import { RecordForm } from './form';
import { AssessmentView, SubmissionView } from './workflows';
import { download } from './files';

const welcomeTheme: Record<string, 'platform' | 'school' | 'teacher' | 'student' | 'parent'> = {
  PLATFORM_ADMIN: 'platform',
  SCHOOL_ADMIN: 'school',
  TEACHER: 'teacher',
  STUDENT: 'student',
  PARENT: 'parent',
};
const welcomeIntro: Record<string, [string, string]> = {
  PLATFORM_ADMIN: ['تابع المدارس المتصلة وأدِر المنصة.', 'Follow connected schools and manage the platform.'],
  SCHOOL_ADMIN: ['أدِر الأعضاء والصفوف والسنة الدراسية.', 'Manage members, classes and the academic year.'],
  TEACHER: ['صفوفك ودروسك وتقييماتك جاهزة.', 'Your classes, lessons and assessments are ready.'],
  STUDENT: ['مهامك ودروسك بانتظارك. يلا نبدأ!', 'Your tasks and lessons are waiting. Let’s go!'],
  PARENT: ['تابع تعلّم أبنائك ونتائجهم المنشورة.', 'Follow your children’s learning and results.'],
};
function ChildAvatar({ name, seed }: { name: string; seed: string }) {
  const [from, to] = paletteFor(seed);
  return (
    <Gradient
      colors={[from, to]}
      style={{ width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}
    >
      <Txt style={{ color: '#fff', fontWeight: '800', fontSize: 18, textAlign: 'center' }}>{initials(name)}</Txt>
    </Gradient>
  );
}
export function ConnectedApp() {
  return (
    <ConnectedProvider>
      <Shell />
    </ConnectedProvider>
  );
}
function Shell() {
  const n = useConnected();
  const { ar, user, route, role } = n;
  const tabs =
    role === 'PARENT'
      ? ['children', 'results', 'notifications', 'more']
      : role === 'STUDENT'
        ? ['dashboard', 'tasks', 'results', 'more']
        : role === 'SCHOOL_ADMIN'
          ? ['dashboard', 'users', 'academics', 'more']
          : role === 'PLATFORM_ADMIN'
            ? ['dashboard', 'schools', 'profile', 'more']
            : ['dashboard', 'classes', 'submissions', 'more'];
  const screenKey = `${user?.id}:${user?.activeSchoolId}:${role}:${n.child?.link.id}:${route.page}:${route.id}:${route.edit}`;
  return (
    <RoleThemeProvider role={role}>
    <SafeAreaView
      edges={['left', 'right']}
      style={[styles.screen, { direction: ar ? 'rtl' : 'ltr' }]}
    >
      <StatusBar style="light" />
      <ShellHeader>
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <View style={{ flex: 1 }}>
            <Txt style={{ color: 'white', fontWeight: '800', fontSize: 18 }}>{ar ? 'وصل' : 'Wasl'}</Txt>
            {user && <Txt style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12 }}>{user.fullName}</Txt>}
          </View>
          <View style={styles.row}>
            <HeaderPill label="عربي" selected={ar} onPress={() => void n.setLocale('ar')} />
            <HeaderPill label="English" selected={!ar} onPress={() => void n.setLocale('en')} />
          </View>
        </View>
        {user && (
          <>
            <View style={{ backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 16, padding: 10, paddingBottom: 0 }}>
              <Select
                label={ar ? 'المدرسة والدور' : 'School and role'}
                value={JSON.stringify([user.activeSchoolId, user.activeRole])}
                options={user.memberships.map((m) => ({
                  value: JSON.stringify([m.schoolId, m.role]),
                  label: `${m.schoolName ?? (ar ? 'المنصة' : 'Platform')} · ${word(m.role, ar)}`,
                }))}
                onChange={(id) => {
                  const m = user.memberships.find(
                    (m) => JSON.stringify([m.schoolId, m.role]) === id,
                  );
                  if (m) void n.switchContext(m.schoolId, m.role);
                }}
              />
            </View>
            <View style={styles.row}>
              <Button secondary onPress={() => void n.back()}>
                {ar ? 'رجوع' : 'Back'}
              </Button>
              <Button secondary onPress={() => void n.logout()}>
                {ar ? 'خروج' : 'Sign out'}
              </Button>
            </View>
          </>
        )}
      </ShellHeader>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <NativeEducationBackground />
        <ScrollView
          key={screenKey}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {n.error && (
            <View style={styles.error}>
              <Txt accessibilityRole="alert" accessibilityLiveRegion="assertive">
                {n.error}
              </Txt>
              <Button
                secondary
                onPress={() => {
                  if (user) n.refresh();
                  else void n.restore();
                }}
              >
                {ar ? 'إعادة المحاولة' : 'Retry'}
              </Button>
            </View>
          )}
          {n.success && (
            <View style={styles.notice}>
              <Txt accessibilityLiveRegion="polite">{n.success}</Txt>
            </View>
          )}
          {!n.ready ? (
            <Txt>{ar ? 'جاري التحميل...' : 'Loading...'}</Txt>
          ) : user ? (
            <ScreenTransition>
              <Txt title accessibilityRole="header">
                {word(route.page, ar)}
                {n.child ? ' · ' + n.child.student.fullName : ''}
              </Txt>
              <Content />
            </ScreenTransition>
          ) : (
            <Login />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      {user ? (
        <TabBar
          tabs={tabs.map((page) => ({ page, label: word(page, ar) }))}
          selected={route.page}
          onSelect={(page) => void n.go({ page })}
        />
      ) : (
        <BottomInset />
      )}
    </SafeAreaView>
    </RoleThemeProvider>
  );
}
function Login() {
  const n = useConnected();
  const { ar } = n;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <Card>
      <NativeEducationArt theme="entry" />
      <Txt title>{ar ? 'تسجيل الدخول' : 'Sign in'}</Txt>
      <Field
        label={ar ? 'البريد الإلكتروني' : 'Email'}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="username"
        keyboardType="email-address"
      />
      <Field
        label={ar ? 'كلمة المرور' : 'Password'}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
      />
      <Button disabled={!email.trim() || !password} onPress={() => void n.login(email, password)}>
        {ar ? 'دخول' : 'Sign in'}
      </Button>
    </Card>
  );
}
function Content() {
  const n = useConnected();
  const { ar, role, route, key, record, api } = n;
  const config = catalog[key];
  if (n.loading)
    return (
      <Txt accessibilityLiveRegion="polite">{ar ? 'تحميل البيانات...' : 'Loading data...'}</Txt>
    );
  if (route.page === 'profile') return <Profile />;
  if (route.page === 'dashboard' || route.page === 'more')
    return (
      <>
        {route.page === 'dashboard' && (
          <NativeWelcome
            theme={welcomeTheme[role ?? ''] ?? 'entry'}
            title={word(role ?? '', ar)}
            name={(ar ? 'أهلًا، ' : 'Welcome, ') + (n.user?.fullName ?? '')}
            intro={(welcomeIntro[role ?? ''] ?? welcomeIntro.STUDENT)[ar ? 0 : 1]}
          />
        )}
        <NativeQuickActions
          rows={roleNav[role!]
            .filter((p) => p !== route.page)
            .map((p) => ({ page: p, label: word(p, ar) }))}
          open={(p) => void n.go({ page: p })}
        />
      </>
    );
  if (route.page === 'academics')
    return (
      <NativeQuickActions
        rows={academics.map((p) => ({ page: p, label: word(p, ar) }))}
        open={(p) => void n.go({ page: p })}
      />
    );
  if (route.page === 'children')
    return (
      <>
        {n.family.map((c, i) => (
          <Card key={c.link.id} index={i}>
            <ChildAvatar name={c.student.fullName} seed={c.student.id} />
            <Txt title>{c.student.fullName}</Txt>
            <Txt muted>{ar ? c.school.nameAr || c.school.name : c.school.name}</Txt>
            <Button onPress={() => void n.switchContext(c.school.id, 'PARENT', c)}>
              {ar ? 'عرض التعلم' : 'View learning'}
            </Button>
          </Card>
        ))}
        {!n.family.length && (
          <Txt>
            {ar
              ? 'لا توجد روابط أطفال موثّقة ومتاحة.'
              : 'There are no approved child links available.'}
          </Txt>
        )}
      </>
    );
  if (role === 'PARENT' && !n.child && route.page !== 'notifications')
    return (
      <Card>
        <Txt>{ar ? 'اختر أحد أبنائك لعرض المحتوى.' : 'Choose a child to view their content.'}</Txt>
        <Button onPress={() => void n.go({ page: 'children' })}>{word('children', ar)}</Button>
      </Card>
    );
  if ((route.id === 'new' || route.edit) && config) {
    if (!config[record ? 'edit' : 'create']?.includes(role!))
      return (
        <Txt>
          {ar ? 'هذه العملية غير متاحة لحسابك.' : 'This action is unavailable to your account.'}
        </Txt>
      );
    if (route.edit && !record) return null;
    return <RecordForm />;
  }
  if (route.id && record) {
    if (key === 'assessments') return <AssessmentView row={record} />;
    if (key === 'submissions' || key === 'results') return <SubmissionView row={record} />;
    return (
      <Card>
        <Txt title>{rowName(record, ar)}</Txt>
        {config?.edit?.includes(role!) && (!record.status || record.status === 'DRAFT') && (
          <Button secondary onPress={() => void n.go({ ...route, edit: true })}>
            {ar ? 'تعديل' : 'Edit'}
          </Button>
        )}
        <Actions row={record} />
        {config?.columns.map((column) => (
          <Txt key={column}>
            {word(column, ar)}: {format(n.display(record, column), ar)}
          </Txt>
        ))}
        {typeof record.body === 'string' && <Txt>{record.body}</Txt>}
        {record.type === 'FILE' && typeof record.storageKey === 'string' && (
          <Button
            onPress={() =>
              void n.run(() => download(api, String(record.storageKey),
                role === 'PARENT' && n.child
                  ? { studentId: n.child.student.id, schoolId: n.child.school.id }
                  : undefined), undefined, false)
            }
          >
            {ar ? 'تنزيل الملف' : 'Download file'}
          </Button>
        )}
        {typeof record.url === 'string' && /^https:\/\//.test(record.url) && (
          <Button
            secondary
            onPress={() =>
              void Linking.openURL(String(record.url)).catch(() =>
                n.setError(ar ? 'تعذر فتح الرابط.' : 'Could not open link.'),
              )
            }
          >
            {ar ? 'فتح الرابط' : 'Open link'}
          </Button>
        )}
        {key === 'schools' && role === 'PLATFORM_ADMIN' && <Provision schoolId={record.id} />}
        {key === 'lessons' && (
          <Button secondary onPress={() => void n.go({ page: 'resources' })}>
            {word('resources', ar)}
          </Button>
        )}
      </Card>
    );
  }
  return <Records />;
}
function format(raw: unknown, ar: boolean): string {
  if (raw === null || raw === undefined || raw === '') return '—';
  if (typeof raw === 'boolean') return raw ? (ar ? 'نعم' : 'Yes') : ar ? 'لا' : 'No';
  return word(String(raw), ar);
}
function Records() {
  const n = useConnected();
  const { ar, key, role } = n;
  const config = catalog[key];
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const rows = n.rows.filter((r) =>
    Object.values(r)
      .filter((v) => typeof v === 'string')
      .join(' ')
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const columns =
    key === 'classes'
      ? ['title', 'teacher']
      : key === 'submissions' || key === 'gradebook'
        ? ['studentId', 'assessmentId', 'status', 'score']
        : key === 'results'
          ? ['title', 'score', 'totalPoints']
          : (config?.columns ?? []);
  return (
    <>
      <Field
        label={ar ? 'بحث' : 'Search'}
        value={search}
        onChangeText={(v) => {
          setSearch(v);
          setPage(1);
        }}
      />
      {config?.create?.includes(role!) && (
        <Button onPress={() => void n.go({ page: key, id: 'new' })}>
          {ar ? 'إضافة' : 'Add'} · {word(key, ar)}
        </Button>
      )}
      {key === 'notifications' && (
        <Button
          secondary
          onPress={() => void n.run(() => n.api.call('notifications/read-all', 'POST'))}
        >
          {ar ? 'تعليم الكل كمقروء' : 'Mark all read'}
        </Button>
      )}
      {rows.slice((page - 1) * 20, page * 20).map((row, i) => (
        <Card key={row.id} index={i}>
          <Txt title>
            {['submissions', 'gradebook'].includes(key)
              ? `${format(n.display(row, 'assessmentId'), ar)} · ${format(n.display(row, 'studentId'), ar)}`
              : key === 'memberships'
                ? format(n.display(row, 'userId'), ar)
                : rowName(row, ar)}
          </Txt>
          {columns
            .filter((c) => c !== 'title')
            .map((c) => (
              <Txt key={c}>
                {word(c, ar)}: {format(n.display(row, c), ar)}
              </Txt>
            ))}
          {key !== 'classes' && (
            <Button
              secondary
              onPress={() =>
                void n.go({ page: key === 'gradebook' ? 'submissions' : key, id: row.id })
              }
            >
              {ar ? 'عرض' : 'View'}
            </Button>
          )}
          <Actions row={row} />
        </Card>
      ))}
      {!rows.length && (
        <Card>
          <NativeEducationArt subject="" width={90} />
          <Txt>{ar ? 'لا توجد سجلات لعرضها.' : 'No records to display.'}</Txt>
        </Card>
      )}
      <View style={styles.row}>
        <Button secondary disabled={page === 1} onPress={() => setPage(page - 1)}>
          {ar ? 'السابق' : 'Previous'}
        </Button>
        <Txt>
          {page} · {rows.length}
        </Txt>
        <Button secondary disabled={page * 20 >= rows.length} onPress={() => setPage(page + 1)}>
          {ar ? 'التالي' : 'Next'}
        </Button>
      </View>
    </>
  );
}
function Actions({ row }: { row: Row }) {
  const n = useConnected();
  const { api, ar, key, role } = n;
  const mutate = (path: string, method = 'POST', body?: object) =>
    void confirmAction(ar ? 'تأكيد تنفيذ العملية؟' : 'Confirm this action?').then((ok) => {
      if (ok) void n.run(() => api.call(path, method, body));
    });
  if (key === 'notifications' && !row.readAt)
    return (
      <Button
        secondary
        onPress={() => void n.run(() => api.call(`notifications/${row.id}/read`, 'PATCH'))}
      >
        {ar ? 'تعليم كمقروء' : 'Mark read'}
      </Button>
    );
  if (key === 'schools' && role === 'PLATFORM_ADMIN')
    return (
      <Button
        secondary
        onPress={() => mutate(`admin/schools/${row.id}`, 'PATCH', { active: !row.active })}
      >
        {row.active ? (ar ? 'تعليق' : 'Suspend') : ar ? 'تفعيل' : 'Reactivate'}
      </Button>
    );
  if (key === 'memberships' && role === 'SCHOOL_ADMIN')
    return (
      <Button
        secondary
        onPress={() => mutate(`memberships/${row.id}`, 'PATCH', { active: !row.active })}
      >
        {row.active ? (ar ? 'تعطيل' : 'Deactivate') : ar ? 'تفعيل' : 'Activate'}
      </Button>
    );
  if (key === 'years' && role === 'SCHOOL_ADMIN')
    return (
      <Button
        secondary
        onPress={() => mutate(`academic-years/${row.id}`, 'PATCH', { archived: !row.archived })}
      >
        {row.archived ? (ar ? 'إلغاء الأرشفة' : 'Unarchive') : ar ? 'أرشفة' : 'Archive'}
      </Button>
    );
  if (key === 'links' && role === 'SCHOOL_ADMIN')
    return (
      <View style={styles.row}>
        {row.status !== 'VERIFIED' && (
          <Button
            secondary
            onPress={() => mutate(`parent-links/${row.id}`, 'PATCH', { status: 'VERIFIED' })}
          >
            {ar ? 'توثيق' : 'Verify'}
          </Button>
        )}
        {row.status !== 'REJECTED' && (
          <Button
            secondary
            onPress={() => mutate(`parent-links/${row.id}`, 'PATCH', { status: 'REJECTED' })}
          >
            {ar ? 'إلغاء الوصول' : 'Revoke access'}
          </Button>
        )}
      </View>
    );
  if (
    key === 'lessons' &&
    role === 'TEACHER' &&
    ['DRAFT', 'PUBLISHED'].includes(String(row.status))
  )
    return (
      <Button
        secondary
        onPress={() =>
          mutate(`lessons/${row.id}`, 'PATCH', {
            status: row.status === 'DRAFT' ? 'PUBLISHED' : 'ARCHIVED',
          })
        }
      >
        {row.status === 'DRAFT' ? (ar ? 'نشر' : 'Publish') : ar ? 'أرشفة' : 'Archive'}
      </Button>
    );
  if (
    key === 'announcements' &&
    ['TEACHER', 'SCHOOL_ADMIN'].includes(role!) &&
    ['DRAFT', 'PUBLISHED'].includes(String(row.status))
  )
    return (
      <Button
        secondary
        onPress={() =>
          mutate(`announcements/${row.id}/${row.status === 'DRAFT' ? 'publish' : 'archive'}`)
        }
      >
        {row.status === 'DRAFT' ? (ar ? 'نشر' : 'Publish') : ar ? 'أرشفة' : 'Archive'}
      </Button>
    );
  return null;
}
function Profile() {
  const n = useConnected();
  const [name, setName] = useState(n.user?.fullName ?? '');
  return (
    <Card>
      <Field
        label={n.ar ? 'الاسم الكامل' : 'Full name'}
        value={name}
        onChangeText={(v) => {
          setName(v);
          n.setDirty(true);
        }}
      />
      <Field label={n.ar ? 'البريد الإلكتروني' : 'Email'} value={n.user?.email} editable={false} />
      <Button
        onPress={() =>
          void n.run(
            async () => {
              const epoch = n.api.epoch;
              await n.api.call('me/profile', 'PATCH', { fullName: name }, epoch);
              return n.api.call<MeDto>('me', 'GET', undefined, epoch);
            },
            n.setUser,
          )
        }
      >
        {n.ar ? 'حفظ' : 'Save'}
      </Button>
    </Card>
  );
}
function Provision({ schoolId }: { schoolId: string }) {
  const n = useConnected();
  const { ar } = n;
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  return (
    <Card>
      <Txt title>{ar ? 'تعيين مدير المدرسة' : 'Provision school administrator'}</Txt>
      <Field
        label={ar ? 'البريد الإلكتروني' : 'Email'}
        value={email}
        autoCapitalize="none"
        keyboardType="email-address"
        onChangeText={setEmail}
      />
      <Field
        label={ar ? 'الاسم (لحساب جديد)' : 'Name (new account)'}
        value={name}
        onChangeText={setName}
      />
      <Field
        label={ar ? 'كلمة المرور الأولية (لحساب جديد)' : 'Initial password (new account)'}
        value={password}
        secureTextEntry
        onChangeText={setPassword}
      />
      <Button
        onPress={() =>
          void n.run(
            () =>
              n.api.call(`admin/schools/${schoolId}/administrator`, 'POST', {
                email,
                ...(name ? { fullName: name } : {}),
                ...(password ? { password } : {}),
              }),
            () => setPassword(''),
          )
        }
      >
        {ar ? 'تعيين المدير' : 'Assign administrator'}
      </Button>
    </Card>
  );
}
