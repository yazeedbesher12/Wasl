import { StatusBar } from 'expo-status-bar';
import { I18nManager, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { context, label, learningContext, learningIdentity } from '../../packages/shared/src/demo';
import type { NamedView } from '../../packages/shared/src/demo';
import { NativeProvider, useNative } from './src/context';
import { NativeContent } from './src/screens';
import { Button, styles, Txt } from './src/ui';
import { EducationMotionProvider, NativeEducationBackground, NativeNavIcon, NativeReveal } from './src/education';

function NativeApp() {
  const n = useNative();
  const { data, session, locale, setLocale, route, ui, t, ready, error, success, persistent, go, back } = n;
  let identity: { user: NamedView; school?: NamedView; role: string } | undefined;
  try { if (data) {
    const role = data.records.memberships.find(m => m.id === session.membershipId)?.values.role;
    if (role === 'STUDENT' || role === 'PARENT') {
      const c = learningIdentity(data, session); identity = { ...c, role: c.role };
      try { const scoped = learningContext(data, { ...session, childLinkId: route.childLinkId ?? session.childLinkId }); identity = { user: scoped.user, school: scoped.school, role: c.role }; } catch { /* Parent global pages do not require a selected child. */ }
    } else { const c = context(data, session); identity = { user: c.user, school: c.school, role: c.admin ? 'schoolAdmin' : 'teacher' }; }
  } } catch { /* Screens provide an actionable unavailable state. */ }
  const tabs = identity?.role === 'schoolAdmin' ? ['dashboard', 'memberships', 'academics', 'more'] : identity?.role === 'parent' ? ['children', 'dashboard', 'results', 'more'] : identity?.role === 'student' ? ['dashboard', 'classes', 'tasks', 'more'] : ['dashboard', 'classes', 'submissions', 'more'];
  return <SafeAreaView style={[styles.screen, { backgroundColor: '#10264D', direction: locale === 'ar' ? 'rtl' : 'ltr' }]}>
    <StatusBar style="light" />
    <View style={styles.header}>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        {ui.stack.length > 1 && <Button secondary disabled={n.busy} onPress={() => back()}>{locale === 'ar' ? '→' : '←'} {t('back')}</Button>}
        <View style={{ flex: 1 }}><Txt style={{ fontWeight: '700', color: '#FFFFFF' }}>{identity?.school ? label(locale, identity.school) : t('wasl')}</Txt><Txt style={{ color: '#B6C8E7', fontSize: 12 }}>{identity ? `${label(locale, identity.user)} · ${t(identity.role)}` : t('demo')}</Txt></View>
      </View>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <View style={styles.row}>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: locale === 'ar' }} onPress={() => void setLocale('ar')} style={[styles.tab, { flex: 0, paddingHorizontal: 13 }, locale === 'ar' && styles.selectedTab]}><Txt style={{ color: '#FFFFFF' }}>عربي</Txt></Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: locale === 'en' }} onPress={() => void setLocale('en')} style={[styles.tab, { flex: 0, paddingHorizontal: 13 }, locale === 'en' && styles.selectedTab]}><Txt style={{ color: '#FFFFFF' }}>English</Txt></Pressable>
        </View>
        {route.page !== 'entry' && <Button secondary disabled={n.busy} onPress={() => go({ page: 'entry' })}>{t('switchAccount')}</Button>}
      </View>
    </View>
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: "#F0F5FF" }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <NativeEducationBackground /><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" key={`${session.membershipId}:${route.childLinkId ?? session.childLinkId ?? ''}:${route.page}:${route.id ?? ''}:${route.edit ? 'edit' : route.attempt ? 'attempt' : 'view'}`}>
        {I18nManager.isRTL !== (locale === 'ar') && <View style={styles.notice}><Txt muted>{t('reloadDirection')}</Txt></View>}
        {!persistent && <View style={styles.notice}><Txt accessibilityLiveRegion="polite">{t('storageError')}</Txt></View>}
        {error && <View style={styles.error}><Txt accessibilityRole="alert" accessibilityLiveRegion="assertive">{t(error.code)}</Txt></View>}
        {success && <View style={styles.notice}><Txt accessibilityLiveRegion="polite">{t(success)}</Txt></View>}
        <View style={styles.row}><Txt title>{t(route.page === 'entry' ? 'switchAccount' : route.attempt ? 'attempt' : route.page === 'results' && ['student', 'parent'].includes(identity?.role ?? '') ? 'releasedResults' : route.page === 'classes' && identity?.role === 'parent' ? 'childClasses' : route.page)}</Txt><Txt muted>{t('demo')}</Txt></View>
        {ready ? <NativeReveal><NativeContent /></NativeReveal> : <Txt accessibilityLiveRegion="polite">{t('loading')}</Txt>}
        <Txt muted>{t('localNotice')}</Txt>
      </ScrollView>
    </KeyboardAvoidingView>
    {identity && route.page !== 'entry' && <View style={styles.tabs}>{tabs.map(page => <Pressable key={page} accessibilityRole="tab" accessibilityState={{ selected: page === route.page, disabled: n.busy }} disabled={n.busy} onPress={() => go({ page })} style={[styles.tab, page === route.page && styles.selectedTab]}><NativeNavIcon page={page} selected={page === route.page} /><Txt style={{ textAlign: 'center', fontSize: 11, fontWeight: '600', color: page === route.page ? '#FFFFFF' : '#BCD0EF', marginTop: 5 }}>{t(page === 'results' && ['student', 'parent'].includes(identity.role) ? 'releasedResults' : page)}</Txt></Pressable>)}</View>}
  </SafeAreaView>;
}
export default function App() { return <SafeAreaProvider><NativeProvider><EducationMotionProvider><NativeApp /></EducationMotionProvider></NativeProvider></SafeAreaProvider>; }
