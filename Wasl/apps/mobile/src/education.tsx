import { Children, createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AccessibilityInfo, Animated, AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Reanimated from "react-native-reanimated";
import { designTokens as c, educationMotion, gradients, greetingKey, navigationGroup, quickActionPalette, subjectShapes, subjectTheme, welcomeShapes } from "../../../packages/shared/src/demo";
import type { VectorShape, WelcomeTheme } from "../../../packages/shared/src/demo";
import { usePresentation as useNative } from "./presentation";
import { Gradient, enterAt, haptic, screenEnter, useRoleTheme } from "./theme";

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
/** Looping float; stops and resets whenever motion is disabled or the app is inactive. */
function useFloat(enabled: boolean, distance: number, halfCycle: number) {
  const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!enabled) { float.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([Animated.timing(float, { toValue: -distance, duration: halfCycle, isInteraction: false, useNativeDriver: true }), Animated.timing(float, { toValue: 0, duration: halfCycle, isInteraction: false, useNativeDriver: true })]));
    loop.start(); return () => { loop.stop(); float.setValue(0); };
  }, [enabled, float, distance, halfCycle]);
  return float;
}
const greetingWords = { morning: ["صباح الخير", "Good morning", "☀️"], afternoon: ["نهارك سعيد", "Good afternoon", "🌤️"], evening: ["مساء الخير", "Good evening", "🌙"] } as const;
/** Role-gradient welcome. `chips` must carry real data only. */
export function NativeWelcome({ title, name, intro, theme, children, chips }: { title: string; name?: string; intro: string; theme: WelcomeTheme; children?: ReactNode; chips?: string[] }) {
  const { locale } = useNative(); const align = { textAlign: locale === "ar" ? "right" as const : "left" as const, writingDirection: locale === "ar" ? "rtl" as const : "ltr" as const };
  const enabled = useEducationMotion(); const float = useFloat(enabled, 12, educationMotion.welcomeHalfCycle); const r = useRoleTheme();
  const g = greetingWords[greetingKey()];
  return <Reanimated.View entering={screenEnter(enabled)} style={[artStyles.welcomeShadow, { shadowColor: r.from }]}>
    <Gradient colors={[r.from, r.to]} style={artStyles.welcome}>
      <View pointerEvents="none" accessible={false} style={artStyles.orbit} /><View pointerEvents="none" accessible={false} style={artStyles.glow} />
      <Text style={[artStyles.eyebrow, align]}>{locale === "ar" ? g[0] : g[1]} {g[2]} · {title}</Text>
      <Text accessibilityRole="header" style={[artStyles.heading, align]}>{name || title}</Text>
      <Text style={[artStyles.intro, align]}>{intro}</Text>
      {!!chips?.length && <View style={[artStyles.chips, { flexDirection: "row" }]}>{chips.map(chip => <Text key={chip} style={artStyles.chip}>{chip}</Text>)}</View>}
      <Animated.View style={{ transform: [{ translateY: float }] }}><NativeEducationArt theme={theme} width={220} /></Animated.View>
      {children && <View style={artStyles.actions}>{Children.map(children, child => <View style={{ flex: 1, minWidth: 105 }}>{child}</View>)}</View>}
    </Gradient>
  </Reanimated.View>;
}
export function NativeSubjects({ title, intro, rows, open }: { title: string; intro: string; rows: { id: string; name: string; subject: string; detail?: string }[]; open: (id: string) => void }) {
  const { locale, busy } = useNative();
  const align = { textAlign: locale === "ar" ? "right" as const : "left" as const };
  const enabled = useEducationMotion(); const r = useRoleTheme();
  if (!rows.length) return null;
  return <Reanimated.View entering={enterAt(1, enabled)} style={[artStyles.subjects, { shadowColor: r.from }]}><Text accessibilityRole="header" style={[artStyles.sectionTitle, align]}>{title}</Text><Text style={[artStyles.subjectHelp, align]}>{intro}</Text><ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ gap: 9, paddingVertical: 14 }}><View style={{ flexDirection: "row", gap: 9 }}>{rows.map((row, i) => <Reanimated.View key={row.id} entering={enterAt(i + 2, enabled)}><Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} accessibilityLabel={`${row.name}${row.detail ? ` · ${row.detail}` : ""}`} onPress={() => open(row.id)} style={({ pressed }) => [artStyles.subject, { backgroundColor: r.soft }, pressed && { transform: [{ scale: .96 }] }]}><NativeEducationArt subject={row.subject} width={112} /><Text style={artStyles.subjectName}>{row.name}</Text>{row.detail && <Text style={artStyles.subjectDetail}>{row.detail}</Text>}</Pressable></Reanimated.View>)}</View></ScrollView></Reanimated.View>;
}
export function NativeNavigation({ pages, open, label }: { pages: string[]; open: (page: string) => void; label: (page: string) => string }) {
  const { t, locale, busy } = useNative();
  const r = useRoleTheme(); const enabled = useEducationMotion();
  return <Gradient colors={gradients.sidebar} style={{ borderRadius: 26, padding: 17, gap: 10, overflow: "hidden" }}>{["navWorkspace", "navManage", "navLearning", "navAccount"].map(group => {
    const rows = pages.filter(p => navigationGroup(p) === group); if (!rows.length) return null;
    return <View key={group}><Text style={{ color: "#9AA3D6", fontSize: 11, fontWeight: "700", marginVertical: 12, textAlign: locale === "ar" ? "right" : "left" }}>{t(group)}</Text>{rows.map((page, i) => <Reanimated.View key={page} entering={enterAt(i, enabled)}><Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => { haptic(); open(page); }} style={({ pressed }) => ({ minHeight: 52, flexDirection: "row", alignItems: "center", gap: 13, borderRadius: 14, paddingHorizontal: 14, backgroundColor: pressed ? r.from : "rgba(255,255,255,0.07)", marginBottom: 6 })}><NativeNavIcon page={page} /><Text style={{ color: "#FFFFFF", fontSize: 14, fontWeight: "600", flex: 1, textAlign: locale === "ar" ? "right" : "left", paddingVertical: 12 }}>{label(page)}</Text><Text style={{ color: "#AFB8EF" }}>{locale === "ar" ? "‹" : "›"}</Text></Pressable></Reanimated.View>)}</View>;
  })}</Gradient>;
}
/** Colourful gradient tiles. Accessible name is the label only. */
export function NativeQuickActions({ rows, open }: { rows: { page: string; label: string }[]; open: (page: string) => void }) {
  const { busy, locale } = useNative(); const enabled = useEducationMotion();
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>{rows.map((row, i) => {
    const [from, to, glow] = quickActionPalette[i % quickActionPalette.length];
    return <Reanimated.View key={row.page} entering={enterAt(i + 1, enabled)} style={{ flexBasis: "46%", flexGrow: 1 }}>
      <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => { haptic(); open(row.page); }} style={({ pressed }) => ({ minHeight: 108, backgroundColor: "#FFFFFF", borderRadius: 22, padding: 15, gap: 12, borderWidth: 1, borderColor: c.border, shadowColor: `rgb(${glow})`, shadowOpacity: .16, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 3, transform: [{ scale: pressed && enabled ? .96 : 1 }] })}>
        <Gradient colors={[from, to]} style={{ width: 44, height: 44, borderRadius: 15, justifyContent: "center", alignItems: "center" }}><NativeNavIcon page={row.page} selected /></Gradient>
        <Text style={{ color: c.text, fontWeight: "800", fontSize: 15, lineHeight: 23, textAlign: locale === "ar" ? "right" : "left" }}>{row.label}</Text>
      </Pressable>
    </Reanimated.View>;
  })}</View>;
}
/** Soft drifting colour blobs behind content; static when motion is off. */
export function NativeEducationBackground() {
  const enabled = useEducationMotion(); const r = useRoleTheme();
  const a = useFloat(enabled, 26, educationMotion.backgroundHalfCycle); const b = useFloat(enabled, -22, educationMotion.backgroundHalfCycle * 1.3);
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, { overflow: "hidden" }]}>
    <Animated.View style={{ position: "absolute", width: 320, height: 320, borderRadius: 160, end: -150, top: -90, backgroundColor: r.from, opacity: .14, transform: [{ translateY: a }, { translateX: a }] }} />
    <Animated.View style={{ position: "absolute", width: 280, height: 280, borderRadius: 140, start: -140, bottom: 60, backgroundColor: r.to, opacity: .11, transform: [{ translateY: b }] }} />
    <Animated.View style={{ position: "absolute", width: 150, height: 150, borderRadius: 75, end: 30, top: 380, backgroundColor: c.yellow, opacity: .16, transform: [{ translateX: b }] }} />
  </View>;
}
/** One-time entry reveal per mount. */
export function NativeReveal({ children }: { children: ReactNode }) {
  const enabled = useEducationMotion(); const [first] = useState(enabled);
  return <Reanimated.View entering={first ? screenEnter(true) : undefined}>{children}</Reanimated.View>;
}
/** Small consistent navigation mark; distinctive silhouettes without an icon dependency. */
export function NativeNavIcon({ page, selected = false, color: tint }: { page: string; selected?: boolean; color?: string }) {
  const color = tint ?? (selected ? "#FFFFFF" : "#C3CAF2");
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
  welcomeShadow: { borderRadius: 28, borderBottomStartRadius: 8, marginBottom: 22, shadowOpacity: .35, shadowRadius: 22, shadowOffset: { width: 0, height: 12 }, elevation: 8 },
  welcome: { borderRadius: 28, borderBottomStartRadius: 8, padding: 23, overflow: "hidden" },
  orbit: { position: "absolute", width: 240, height: 240, borderWidth: 2, borderStyle: "dashed", borderColor: "rgba(255,255,255,0.28)", borderRadius: 120, end: -100, top: -90 },
  glow: { position: "absolute", width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(255,255,255,0.16)", start: -70, top: -70 },
  eyebrow: { color: "rgba(255,255,255,0.92)", fontSize: 13, textAlign: "auto", fontWeight: "600", marginBottom: 4 },
  heading: { color: "#FFFFFF", fontSize: 28, lineHeight: 41, fontWeight: "800", textAlign: "auto", marginBottom: 7 },
  intro: { color: "rgba(255,255,255,0.94)", fontSize: 13, lineHeight: 24, textAlign: "auto" },
  chips: { flexWrap: "wrap", gap: 8, marginTop: 12 }, chip: { color: "#FFFFFF", fontSize: 12, fontWeight: "700", backgroundColor: "rgba(255,255,255,0.2)", borderWidth: 1, borderColor: "rgba(255,255,255,0.32)", borderRadius: 999, paddingVertical: 4, paddingHorizontal: 12, overflow: "hidden" },
  actions: { gap: 9, marginTop: 7, flexDirection: "row", flexWrap: "wrap" }, subjects: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 26, padding: 18, marginBottom: 22, shadowOpacity: .12, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  sectionTitle: { fontSize: 19, lineHeight: 29, fontWeight: "700", color: c.navy, textAlign: "auto" }, subjectHelp: { color: c.muted, fontSize: 12, lineHeight: 21, textAlign: "auto", marginTop: 4 },
  subject: { width: 132, borderRadius: 16, alignItems: "center", padding: 6, minHeight: 174 }, subjectName: { fontSize: 14, fontWeight: "700", color: c.text, textAlign: "center", lineHeight: 24 }, subjectDetail: { fontSize: 11, color: c.muted, textAlign: "center", marginTop: 3 },
  classArt: { backgroundColor: c.tint, borderRadius: 16, paddingVertical: 8, marginBottom: 5 },
});
