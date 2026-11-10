import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { academicKinds, allowed, canCreate, canEdit, context, date, displayRecord, get, label, metrics, number, pageAllowed, pageKind, schoolNav, teacherNav, visible, workspaceRoles } from "../../../packages/shared/src/demo";
import { useNative } from "./context";
import { NativeRows, NativeList } from "./records";
import { NativeEditor } from "./editor";
import { NativeDetail } from "./detail";
import { NativeTransfer } from "./transfer";
import { NativeGradebook } from "./gradebook";
import { NativeLearningPage } from "./learning/page";
import { NativeNavIcon, NativeNavigation, NativeQuickActions, NativeSubjects, NativeWelcome } from "./education";
import { Blank, Button, Card, Field, Select, styles, Txt } from "./ui";
export function NativeEntry() {
  const { data, locale, session, t, selectMembership, load } = useNative();
  const [schoolId, setSchool] = useState(""); const [memberId, setMember] = useState("");
  const [role, setRole] = useState("");
  const school = schoolId || data?.records.memberships.find(m => m.id === session.membershipId)?.schoolId || data?.schools.find(s => s.active)?.id || "";
  const members = data?.records.memberships.filter(m => m.active && m.schoolId === school && get(data!, "users", m.values.userId)?.active && workspaceRoles.some(r => r === m.values.role) && (!role || m.values.role === role)) ?? [];
  const member = members.find(m => m.id === memberId) ?? members.find(m => m.id === session.membershipId) ?? members[0];
  return <View><NativeWelcome title={t("wasl")} intro={t("learningIntro")} name={t("welcomeEntry")} theme="entry" /><Card><Txt title>{t("switchAccount")}</Txt><Txt muted>{t("localNotice")}</Txt>{!data ? <Button secondary onPress={() => void load()}>{t("retry")}</Button> : <><Select label={t("chooseSchool")} value={school} options={data.schools.map(s => ({ value: s.id, label: `${label(locale, s)}${s.active ? "" : ` · ${t("suspended")}`}` }))} onChange={v => { setSchool(v); setMember(""); }} /><Select label={t("role")} value={role} optional options={workspaceRoles.map(r => ({ value: r, label: t(r) }))} onChange={v => { setRole(v); setMember(""); }} /><Select label={t("chooseAccount")} value={member?.id ?? ""} options={members.map(m => ({ value: m.id, label: `${label(locale, get(data, "users", m.values.userId))} · ${t(m.values.role)} · ${get(data, "users", m.values.userId)?.values.email}` }))} onChange={setMember} />{!members.length && <Txt muted>{t("noAccounts")}</Txt>}<Button disabled={!member || !data.schools.find(s => s.id === school)?.active} onPress={() => { if (member) void selectMembership(member.id); }}>{t("enter")}</Button></>}</Card><NativeTransfer /></View>;
}
function NativeDashboard() {
  const { data, session, locale, t, go } = useNative(); if (!data) return null;
  const c = context(data, session); const pref = visible(data, session, "preferences").find(r => r.active); const year = pref ? get(data, "years", pref.values.currentYearId) : visible(data, session, "years").find(r => r.active);
  const events = data.events.filter(e => e.schoolId === c.school.id && (c.admin || visible(data, session, e.kind).some(r => r.id === e.recordId))).slice(0, 8);
  return <View><NativeWelcome title={t("welcome")} name={label(locale, c.user)} intro={t(c.admin ? "welcomeSchool" : "welcomeTeacher")} theme={c.admin ? "school" : "teacher"}><Button onPress={() => go({ page: c.admin ? "memberships" : "lessons" })}>{t(c.admin ? "memberships" : "lessons")}</Button><Button secondary onPress={() => go({ page: c.admin ? "academics" : "classes" })}>{t(c.admin ? "academics" : "classes")}</Button></NativeWelcome>{!c.admin && <NativeSubjects title={t("exploreClasses")} intro={t("subjectStripHelp")} rows={visible(data, session, "assignments").map(a => { const s = get(data, "subjects", a.values.subjectId); return { id: a.id, name: label(locale, s), subject: `${s?.name} ${s?.nameAr}`, detail: label(locale, get(data, "sections", a.values.sectionId)) }; })} open={id => go({ page: "classes", id })} />}<Txt muted>{t("currentYear")}: {label(locale, year)}</Txt><View style={styles.metricGrid}>{metrics(data, session).map(m => <Pressable key={m.label} accessibilityRole="button" style={styles.metric} onPress={() => go({ page: m.page })}><View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: "#315DE5", justifyContent: "center" }}><NativeNavIcon page={m.page} selected /></View><Txt muted>{t(m.label)}</Txt><Txt title style={{ fontSize: 28 }}>{number(locale, m.value)}</Txt></Pressable>)}</View><Card><Txt title>{t("quickActions")}</Txt><NativeQuickActions rows={(c.admin ? ["memberships", "assignments", "enrollments", "announcements"] : ["lessons", "assessments", "submissions"]).map(page => ({ page, label: t(page) }))} open={page => go({ page })} /></Card>{!c.admin && <NativeRows kind="assignments" rows={visible(data, session, "assignments")} title="classes" />}<NativeRows kind="announcements" rows={visible(data, session, "announcements").filter(a => a.active && a.values.status === "published")} title="announcements" /><Card><Txt title>{t("activity")}</Txt>{events.length ? events.map(e => <View key={e.id} style={{ borderStartWidth: 2, borderStartColor: "#CBD9F5", paddingStart: 14, marginBottom: 10 }}><Txt>{t(e.verb)} · {t(e.kind)}</Txt><Txt muted>{label(locale, get(data, "users", e.actorId))}</Txt><Txt muted>{date(locale, e.at)}</Txt><View style={styles.divider} /></View>) : <Blank />}</Card></View>;
}
function NativeSettings() {
  const n = useNative(); const { data, session, t, busy, run, ui, setUI } = n;
  const school = data ? context(data, session).school : undefined;
  const key = `settings:${school?.id}`;
  const initial = { name: school?.name ?? "", nameAr: school?.nameAr ?? "", city: school?.demo.city ?? "", cityAr: school?.demo.cityAr ?? "", locale: school?.locale ?? "ar" };
  const [values, setValues] = useState<Record<string, string>>(ui.forms[key]?.values ?? initial); const baseline = useRef(JSON.stringify(initial));
  useEffect(() => { n.activeDraftKey.current = key; n.setDirty(JSON.stringify(values) !== baseline.current); setUI(old => ({ ...old, forms: { ...old.forms, [key]: { name: "", nameAr: "", values } } })); return () => n.setDirty(false); }, [values, key, setUI, n.setDirty]);
  return <Card><Txt title>{t("settings")}</Txt><Txt muted>{t("settingsHelp")}</Txt>{["name", "nameAr", "city", "cityAr"].map(key => <Field key={key} label={t(key)} value={values[key]} onChangeText={v => setValues({ ...values, [key]: v })} error={n.error?.field === key ? t(n.error.code) : undefined} style={{ writingDirection: key.endsWith("Ar") ? "rtl" : "ltr", textAlign: key.endsWith("Ar") ? "right" : "left" }} />)}<Select label={t("locale")} value={values.locale} options={[{ value: "ar", label: "العربية" }, { value: "en", label: "English" }]} onChange={v => setValues({ ...values, locale: v })} /><Button disabled={busy} onPress={async () => { if (await run({ type: "schoolProfile", input: values })) { baseline.current = JSON.stringify(values); n.setDirty(false); } }}>{t(busy ? "working" : "save")}</Button></Card>;
}
export function NativeContent() {
  const n = useNative(); const { data, session, route, t, go } = n;
  if (route.page === "entry") return <NativeEntry />;
  if (!data) return <Txt>{t("loading")}</Txt>;
  const memberRole = get(data, "memberships", session.membershipId)?.values.role;
  if (memberRole === "STUDENT" || memberRole === "PARENT") return <NativeLearningPage role={memberRole === "PARENT" ? "parent" : "student"} />;
  try {
    const c = context(data, session); const page = route.page;
    if (page === "more") return <View><NativeNavigation pages={c.admin ? schoolNav : teacherNav} open={page => go({ page })} label={t} /><Button secondary onPress={() => go({ page: "entry" })}>{t("switchAccount")}</Button></View>;
    if (!pageAllowed(data, session, page)) throw new Error();
    if (page === "dashboard") return <NativeDashboard />;
    if (page === "gradebook") return <NativeGradebook />;
    if (page === "transfer") return <NativeTransfer />;
    if (page === "settings" && c.admin) return <NativeSettings key={c.school.id} />;
    const kind = pageKind(page); if (!kind) throw new Error();
    const row = route.id && route.id !== "new" ? allowed(data, session, kind, route.id) : undefined;
    if (route.id === "new" || route.edit) { if (!canCreate(data, session, kind) || row && !canEdit(data, session, kind, row)) throw new Error(); return <NativeEditor key={`${session.membershipId}:${kind}:${route.id}`} kind={kind} row={row} />; }
    if (row) return <NativeDetail key={`${session.membershipId}:${kind}:${row.id}`} kind={kind} row={row} />;
    return <View>{["academics", ...academicKinds].includes(page) && <Card>{academicKinds.map(p => <Button secondary key={p} onPress={() => go({ page: p })}>{t(p)}</Button>)}</Card>}{canCreate(data, session, kind) && <View style={{ marginBottom: 20 }}><Button onPress={() => go({ page: kind, id: "new" })}>+ {t("create")}</Button></View>}<NativeList key={`${session.membershipId}:${page}`} kind={kind} /></View>;
  } catch (e) { return <Card><Txt accessibilityRole="alert">{t(e instanceof Error && e.message === "suspended" ? "suspended" : "unavailable")}</Txt><Button secondary onPress={() => go({ page: "entry" })}>{t("switchAccount")}</Button></Card>; }
}
