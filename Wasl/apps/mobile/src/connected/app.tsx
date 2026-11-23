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
import { NativeEducationArt, NativeEducationBackground } from '../education';
import { ConnectedProvider, confirmAction, useConnected } from './context';
import { RecordForm } from './form';
import { AssessmentView, SubmissionView } from './workflows';
import { download } from './files';

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
    <SafeAreaView
      style={[styles.screen, { backgroundColor: '#10264D', direction: ar ? 'rtl' : 'ltr' }]}
    >
      <StatusBar style="light" />
      <View style={styles.header}>
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <Txt style={{ color: 'white', fontWeight: '700' }}>
            {ar ? 'وصل' : 'Wasl'}
            {user ? ' · ' + user.fullName : ''}
          </Txt>
          <View style={styles.row}>
            <Button secondary onPress={() => void n.setLocale('ar')}>
              عربي
            </Button>
            <Button secondary onPress={() => void n.setLocale('en')}>
              English
            </Button>
          </View>
        </View>
        {user && (
          <>
            <View style={{ backgroundColor: '#F0F5FF', borderRadius: 12, padding: 10 }}>
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
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: '#F0F5FF' }}
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
            <>
              <Txt title accessibilityRole="header">
                {word(route.page, ar)}
                {n.child ? ' · ' + n.child.student.fullName : ''}
              </Txt>
              <Content />
            </>
          ) : (
            <Login />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      {user && (
        <View style={styles.tabs}>
          {tabs.map((page) => (
            <View key={page} style={styles.tab}>
              <Button secondary={page !== route.page} onPress={() => void n.go({ page })}>
                {word(page, ar)}
              </Button>
            </View>
          ))}
        </View>
      )}
    </SafeAreaView>
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
        <Card>
          <NativeEducationArt theme="student" />
          <Txt title>
            {ar ? 'أهلًا، ' : 'Welcome, '}
            {n.user?.fullName}
          </Txt>
        </Card>
        {roleNav[role!]
          .filter((p) => p !== route.page)
          .map((p) => (
            <Button secondary key={p} onPress={() => void n.go({ page: p })}>
              {word(p, ar)}
            </Button>
          ))}
      </>
    );
  if (route.page === 'academics')
    return (
      <>
        {academics.map((p) => (
          <Button secondary key={p} onPress={() => void n.go({ page: p })}>
            {word(p, ar)}
          </Button>
        ))}
      </>
    );
  if (route.page === 'children')
    return (
      <>
        {n.family.map((c) => (
          <Card key={c.link.id}>
            <Txt title>{c.student.fullName}</Txt>
            <Txt>{ar ? c.school.nameAr || c.school.name : c.school.name}</Txt>
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
              void n.run(() => download(api, String(record.storageKey)), undefined, false)
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
      {rows.slice((page - 1) * 20, page * 20).map((row) => (
        <Card key={row.id}>
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
            () => n.api.call('me/profile', 'PATCH', { fullName: name }),
            () => {
              void n.api
                .call<MeDto>('me')
                .then(n.setUser)
                .catch(() =>
                  n.setError(n.ar ? 'تعذر تحديث الحساب.' : 'Could not refresh account.'),
                );
            },
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
