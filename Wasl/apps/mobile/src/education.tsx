import { Children, createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AccessibilityInfo, Animated, AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { designTokens as c, educationMotion, navigationGroup, subjectShapes, subjectTheme, welcomeShapes } from "../../../packages/shared/src/demo";
import type { VectorShape, WelcomeTheme } from "../../../packages/shared/src/demo";
import { useNative } from "./context";

const Motion = createContext(false);
/** One accessibility/app lifecycle subscription for all native presentation components. */
export function EducationMotionProvider({ children }: { children: ReactNode }) {
  const [reduced, setReduced] = useState(true); const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    let alive = true; let changed = false;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive && !changed) setReduced(value); }).catch(() => { /* Static is the accessible fallback. */ });
    const reduce = AccessibilityInfo.addEventListener("reduceMotionChanged", value => { changed = true; setReduced(value); });
    const state = AppState.addEventListener("change", value => setActive(value === "active"));
    return () => { alive = false; reduce.remove(); state.remove(); };
  }, []);
  return <Motion.Provider value={!reduced && active}>{children}</Motion.Provider>;
}
export function useEducationMotion() { return useContext(Motion); }
function Shape({ s }: { s: VectorShape }) {
  if (s.type === "line") {
    const length = Math.hypot(s.w, s.h); const weight = s.weight ?? 3;
    return <View style={{ position: "absolute", start: s.x + s.w / 2 - length / 2, top: s.y + s.h / 2 - weight / 2, width: length, height: weight, backgroundColor: s.stroke, borderRadius: weight, transform: [{ rotate: `${Math.atan2(s.h, s.w) * 180 / Math.PI}deg` }] }} />;
  }
  if (s.type === "text") return <Text allowFontScaling={false} style={{ position: "absolute", start: s.x, top: s.y - 2, width: s.w * 1.5, height: s.h * 1.4, fontSize: s.h, lineHeight: s.h * 1.2, color: s.fill, fontWeight: "700", textAlign: "left", writingDirection: "ltr", includeFontPadding: false }}>{s.text}</Text>;
  if (s.type === "ellipse") return <View style={{ position: "absolute", start: s.x, top: s.y + (s.h - s.w) / 2, width: s.w, height: s.w, backgroundColor: s.fill ?? "transparent", borderColor: s.stroke, borderWidth: s.stroke ? s.weight ?? 2.5 : 0, borderRadius: s.w / 2, transform: [{ rotate: `${s.rotate ?? 0}deg` }, { scaleY: s.h / s.w }] }} />;
  return <View style={{ position: "absolute", start: s.x, top: s.y, width: s.w, height: s.h, backgroundColor: s.fill ?? "transparent", borderColor: s.stroke, borderWidth: s.stroke ? s.weight ?? 2.5 : 0, borderRadius: s.radius, transform: [{ rotate: `${s.rotate ?? 0}deg` }] }} />;
}
/** Original vectors rendered with installed RN primitives; no remote images or SVG package. */
export function NativeEducationArt({ theme = "student", subject, width = 280 }: { theme?: WelcomeTheme; subject?: string; width?: number }) {
  const [measured, setMeasured] = useState(width); const sw = subject !== undefined ? 160 : 400; const sh = subject !== undefined ? 160 : 240;
  const shapes = subject !== undefined ? subjectShapes(subjectTheme(subject)) : welcomeShapes(theme);
  return <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" onLayout={e => setMeasured(e.nativeEvent.layout.width)} style={{ width, maxWidth: "100%", height: measured * sh / sw, alignSelf: "center", direction: "ltr" }}><View style={{ width: sw, height: sh, position: "absolute", start: 0, top: 0, transformOrigin: "left top", transform: [{ scale: measured / sw }] }}>{shapes.map((s, i) => <Shape key={i} s={s} />)}</View></View>;
}
export function NativeWelcome({ title, name, intro, theme, children }: { title: string; name?: string; intro: string; theme: WelcomeTheme; children?: ReactNode }) {
  const { locale } = useNative(); const align = { textAlign: locale === "ar" ? "right" as const : "left" as const, writingDirection: locale === "ar" ? "rtl" as const : "ltr" as const };
  const enabled = useEducationMotion(); const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!enabled) { float.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([Animated.timing(float, { toValue: -5, duration: educationMotion.welcomeHalfCycle, isInteraction: false, useNativeDriver: true }), Animated.timing(float, { toValue: 0, duration: educationMotion.welcomeHalfCycle, isInteraction: false, useNativeDriver: true })]));
    loop.start(); return () => { loop.stop(); float.setValue(0); };
  }, [enabled, float]);
  return <View style={artStyles.welcome}><View pointerEvents="none" accessible={false} style={artStyles.orbit} /><Text style={[artStyles.eyebrow, align]}>{title}</Text><Text accessibilityRole="header" style={[artStyles.heading, align]}>{name || title}</Text><Text style={[artStyles.intro, align]}>{intro}</Text><Animated.View style={{ transform: [{ translateY: float }] }}><NativeEducationArt theme={theme} width={220} /></Animated.View>{children && <View style={artStyles.actions}>{Children.map(children, child => <View style={{ flex: 1, minWidth: 105 }}>{child}</View>)}</View>}</View>;
}
export function NativeSubjects({ title, intro, rows, open }: { title: string; intro: string; rows: { id: string; name: string; subject: string; detail?: string }[]; open: (id: string) => void }) {
  const { locale, busy } = useNative();
  const align = { textAlign: locale === "ar" ? "right" as const : "left" as const };
  if (!rows.length) return null;
  return <View style={artStyles.subjects}><Text accessibilityRole="header" style={[artStyles.sectionTitle, align]}>{title}</Text><Text style={[artStyles.subjectHelp, align]}>{intro}</Text><ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ gap: 9, paddingVertical: 14 }}><View style={{ flexDirection: "row", gap: 9 }}>{rows.map(row => <Pressable key={row.id} accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} accessibilityLabel={`${row.name}${row.detail ? ` · ${row.detail}` : ""}`} onPress={() => open(row.id)} style={({ pressed }) => [artStyles.subject, pressed && { backgroundColor: "#E9F0FF" }]}><NativeEducationArt subject={row.subject} width={112} /><Text style={artStyles.subjectName}>{row.name}</Text>{row.detail && <Text style={artStyles.subjectDetail}>{row.detail}</Text>}</Pressable>)}</View></ScrollView></View>;
}
export function NativeNavigation({ pages, open, label }: { pages: string[]; open: (page: string) => void; label: (page: string) => string }) {
  const { t, locale, busy } = useNative();
  return <View style={{ backgroundColor: c.navy, borderRadius: 23, padding: 17, gap: 10 }}>{["navWorkspace", "navManage", "navLearning", "navAccount"].map(group => {
    const rows = pages.filter(p => navigationGroup(p) === group); if (!rows.length) return null;
    return <View key={group}><Text style={{ color: "#9CB4DA", fontSize: 11, marginVertical: 12, textAlign: locale === "ar" ? "right" : "left" }}>{t(group)}</Text>{rows.map(page => <Pressable key={page} accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => open(page)} style={({ pressed }) => ({ minHeight: 52, flexDirection: "row", alignItems: "center", gap: 13, borderRadius: 12, paddingHorizontal: 14, backgroundColor: pressed ? "#315DE5" : "#18335C", marginBottom: 6 })}><NativeNavIcon page={page} /><Text style={{ color: "#FFFFFF", fontSize: 14, flex: 1, textAlign: locale === "ar" ? "right" : "left", paddingVertical: 12 }}>{label(page)}</Text><Text style={{ color: "#AFC6EF" }}>{locale === "ar" ? "‹" : "›"}</Text></Pressable>)}</View>;
  })}</View>;
}
export function NativeQuickActions({ rows, open }: { rows: { page: string; label: string }[]; open: (page: string) => void }) {
  const { busy, locale } = useNative();
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>{rows.map(row => <Pressable key={row.page} accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => open(row.page)} style={({ pressed }) => ({ flexBasis: "47%", flexGrow: 1, minHeight: 98, backgroundColor: pressed ? "#E3ECFF" : "#F0F5FF", borderRadius: 15, padding: 15, gap: 12, borderWidth: 1, borderColor: "#DFE8FA" })}><View style={{ width: 33, height: 33, backgroundColor: c.primary, borderRadius: 10, justifyContent: "center" }}><NativeNavIcon page={row.page} selected /></View><Text style={{ color: c.navy, fontWeight: "600", lineHeight: 23, textAlign: locale === "ar" ? "right" : "left" }}>{row.label}</Text></Pressable>)}</View>;
}
export function NativeEducationBackground() {
  const enabled = useEducationMotion(); const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!enabled) { drift.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([Animated.timing(drift, { toValue: 10, duration: educationMotion.backgroundHalfCycle, isInteraction: false, useNativeDriver: true }), Animated.timing(drift, { toValue: 0, duration: educationMotion.backgroundHalfCycle, isInteraction: false, useNativeDriver: true })])); loop.start();
    return () => { loop.stop(); drift.setValue(0); };
  }, [enabled, drift]);
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFillObject, { overflow: "hidden", opacity: .11 }]}><Animated.View style={{ position: "absolute", width: 210, height: 270, borderWidth: 1.5, borderColor: c.primary, borderRadius: 120, end: -140, top: 65, transform: [{ rotate: "-24deg" }, { translateY: drift }] }} /><View style={{ position: "absolute", width: 180, height: 230, borderWidth: 1.5, borderStyle: "dashed", borderColor: c.primary, borderRadius: 110, start: -120, bottom: 40, transform: [{ rotate: "35deg" }] }} />{[0,1,2,3].map(i => <View key={i} style={{ position: "absolute", width: 4, height: 4, backgroundColor: c.primary, borderRadius: 2, end: 13 + i * 12, top: 390 + i % 2 * 13 }} />)}</View>;
}
export function NativeReveal({ children }: { children: ReactNode }) {
  const enabled = useEducationMotion(); const entered = useRef(false); const progress = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!enabled || entered.current) { progress.setValue(1); return; }
    entered.current = true; progress.setValue(0);
    const animation = Animated.timing(progress, { toValue: 1, duration: educationMotion.reveal, useNativeDriver: true }); animation.start();
    return () => { animation.stop(); progress.setValue(1); };
  }, [enabled, progress]);
  return <Animated.View style={{ opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0,1], outputRange: [7,0] }) }] }}>{children}</Animated.View>;
}
/** Small consistent navigation mark; distinctive silhouettes without an icon dependency. */
export function NativeNavIcon({ page, selected = false }: { page: string; selected?: boolean }) {
  const color = selected ? "#FFFFFF" : "#ACC3EC";
  const grid = page === "dashboard" || page === "more";
  let mark: ReactNode;
  if (grid) mark = [0,1,2,3].map(n => <View key={n} style={{ width: 8, height: 8, borderRadius: page === "more" ? 4 : 2, borderWidth: 1.5, borderColor: color }} />);
  else if (/class|lesson|subject|resource|unit|bank/.test(page)) mark = <View style={{ flexDirection: "row", paddingTop: 2 }}>{[0,1].map(n => <View key={n} style={{ width: 10, height: 16, borderWidth: 1.5, borderColor: color, borderTopStartRadius: 4, borderBottomStartRadius: 2, transform: [{ rotate: n ? "5deg" : "-5deg" }] }} />)}</View>;
  else if (/result|grade|submiss/.test(page)) mark = <View style={{ flexDirection: "row", gap: 3, alignItems: "flex-end", height: 20, borderBottomWidth: 1.5, borderColor: color, paddingBottom: 2 }}>{[9,17,13].map(h => <View key={h} style={{ width: 4, height: h, borderRadius: 1, backgroundColor: color }} />)}</View>;
  else if (/child|member|link|user|profile|enroll/.test(page)) mark = <View style={{ flexDirection: "row", gap: 3 }}>{[0,1].map(n => <View key={n} style={{ alignItems: "center", paddingTop: n * 3, gap: 2 }}><View style={{ width: 7, height: 7, borderRadius: 4, borderWidth: 1.5, borderColor: color }} /><View style={{ width: 9, height: 9, borderTopStartRadius: 5, borderTopEndRadius: 5, borderWidth: 1.5, borderColor: color }} /></View>)}</View>;
  else if (page === "notifications") mark = <View style={{ width: 16, height: 17, borderTopStartRadius: 9, borderTopEndRadius: 9, borderWidth: 1.5, borderColor: color, marginTop: 1 }}><View style={{ width: 20, height: 1.5, backgroundColor: color, position: "absolute", bottom: 1, start: -3 }} /><View style={{ width: 4, height: 3, backgroundColor: color, position: "absolute", bottom: -5, start: 4 }} /></View>;
  else if (/setting|transfer|preference/.test(page)) mark = <View style={{ width: 20, gap: 5, paddingTop: 3 }}>{[5,12,7].map((x,i) => <View key={i} style={{ height: 1.5, backgroundColor: color }}><View style={{ width: 4, height: 6, borderWidth: 1.5, borderColor: color, borderRadius: 2, backgroundColor: selected ? c.primary : c.navy, position: "absolute", start: x, top: -2 }} /></View>)}</View>;
  else mark = <View style={{ width: 17, height: 20, borderWidth: 1.5, borderColor: color, borderRadius: 3, paddingTop: 4, gap: 4 }}><View style={{ height: 1.5, width: 10, backgroundColor: color, alignSelf: "center" }} /><View style={{ height: 1.5, width: 7, backgroundColor: color, alignSelf: "center" }} /></View>;
  return <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: 21, height: 23, alignSelf: "center", flexDirection: "row", flexWrap: "wrap", gap: 3, direction: "ltr" }}>{mark}</View>;
}
export const artStyles = StyleSheet.create({
  welcome: { borderRadius: 25, borderBottomStartRadius: 7, padding: 23, backgroundColor: "#E2ECFF", borderWidth: 1, borderColor: "#C9DAFA", overflow: "hidden", marginBottom: 22 },
  orbit: { position: "absolute", width: 240, height: 240, borderWidth: 1, borderColor: "#B7CEF5", borderRadius: 120, end: -100, top: -90 },
  eyebrow: { color: "#526E9E", fontSize: 13, textAlign: "auto", fontWeight: "600", marginBottom: 4 },
  heading: { color: c.navy, fontSize: 28, lineHeight: 41, fontWeight: "800", textAlign: "auto", marginBottom: 7 },
  intro: { color: "#526A91", fontSize: 13, lineHeight: 24, textAlign: "auto" },
  actions: { gap: 9, marginTop: 7, flexDirection: "row", flexWrap: "wrap" }, subjects: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 24, padding: 18, marginBottom: 22 },
  sectionTitle: { fontSize: 19, lineHeight: 29, fontWeight: "700", color: c.navy, textAlign: "auto" }, subjectHelp: { color: c.muted, fontSize: 12, lineHeight: 21, textAlign: "auto", marginTop: 4 },
  subject: { width: 132, borderRadius: 16, alignItems: "center", padding: 6, minHeight: 174 }, subjectName: { fontSize: 14, fontWeight: "700", color: c.text, textAlign: "center", lineHeight: 24 }, subjectDetail: { fontSize: 11, color: c.muted, textAlign: "center", marginTop: 3 },
  classArt: { backgroundColor: "#EDF3FF", borderRadius: 16, paddingVertical: 8, marginBottom: 5 },
});
