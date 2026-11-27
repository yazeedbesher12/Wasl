import { useState } from "react";
import type { ReactNode } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { TextInputProps, TextProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { designTokens as c, quickActionPalette, statusTones, toneForStatus } from "../../../packages/shared/src/demo";
import { usePresentation as useNative } from "./presentation";
import { NativeEducationArt, useEducationMotion } from "./education";
import { Gradient, enterAt, haptic, rgba, useRoleTheme } from "./theme";
export { haptic };

export function Txt({ children, muted, title, ltr, style, ...props }: TextProps & { children?: ReactNode; muted?: boolean; title?: boolean; ltr?: boolean }) {
  const { locale } = useNative();
  return <Text {...props} style={[styles.text, { textAlign: ltr ? "left" : locale === "ar" ? "right" : "left", writingDirection: ltr ? "ltr" : locale === "ar" ? "rtl" : "ltr" }, muted && styles.muted, title && styles.title, style]}>{children}</Text>;
}
/** Spring press scale (static under reduced motion) plus a light selection haptic. */
function usePress(enabled: boolean) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return {
    style,
    onPressIn: () => { if (enabled) scale.value = withSpring(.96, { damping: 15, stiffness: 400 }); },
    onPressOut: () => { scale.value = enabled ? withSpring(1, { damping: 12, stiffness: 300 }) : 1; },
  };
}
export function Button({ children, onPress, secondary = false, danger = false, disabled = false }: { children: ReactNode; onPress: () => void; secondary?: boolean; danger?: boolean; disabled?: boolean }) {
  const { busy } = useNative(); disabled = disabled || busy;
  const enabled = useEducationMotion(); const press = usePress(enabled); const r = useRoleTheme();
  const colors: [string, string] = danger ? ["#DC2626", "#BE185D"] : [r.from, r.to];
  const label = <Txt style={{ color: secondary ? r.from : "#fff", textAlign: "center", fontWeight: "700" }}>{children}</Txt>;
  return <Animated.View style={[press.style, !secondary && !disabled && { shadowColor: colors[0], shadowOpacity: .3, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 4, borderRadius: c.controlRadius }]}>
    <Pressable accessibilityRole="button" onPressIn={press.onPressIn} onPressOut={press.onPressOut} accessibilityState={{ disabled }} disabled={disabled} onPress={() => { haptic(); onPress(); }} style={({ pressed }) => [styles.button, secondary && [styles.secondary, { borderColor: rgba(r.glow, .3) }, pressed && { backgroundColor: r.soft }], (disabled || (pressed && !secondary)) && { opacity: disabled ? .5 : .9 }]}>
      {!secondary && <Gradient colors={colors} style={[StyleSheet.absoluteFill, { borderRadius: c.controlRadius }]} />}
      {label}
    </Pressable>
  </Animated.View>;
}
export function Card({ children, accent = false, index = 0 }: { children: ReactNode; accent?: boolean; index?: number }) {
  const enabled = useEducationMotion(); const r = useRoleTheme();
  return <Animated.View entering={enterAt(index, enabled)} style={[styles.card, { shadowColor: r.from }, accent && { borderStartWidth: 4, borderStartColor: r.from }]}>{children}</Animated.View>;
}
/** Tappable statistic tile for real, already-loaded counts. */
export function StatTile({ label, value, index = 0, onPress, icon }: { label: string; value: ReactNode; index?: number; onPress: () => void; icon: ReactNode }) {
  const { busy } = useNative(); const enabled = useEducationMotion(); const press = usePress(enabled);
  const [from, to, glow] = quickPalette(index);
  return <Animated.View entering={enterAt(index, enabled)} style={[styles.metric, press.style, { shadowColor: from, borderTopColor: from }]}>
    <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPressIn={press.onPressIn} onPressOut={press.onPressOut} onPress={() => { haptic(); onPress(); }} style={{ gap: 10 }}>
      <Gradient colors={[from, to]} style={[styles.metricIcon, { shadowColor: `rgb(${glow})` }]}>{icon}</Gradient>
      <Txt style={{ fontSize: 30, lineHeight: 38, fontWeight: "800", color: c.text }}>{value}</Txt>
      <Txt muted>{label}</Txt>
    </Pressable>
  </Animated.View>;
}
export function quickPalette(index: number) { return quickActionPalette[index % quickActionPalette.length]; }
export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string }) {
  const { locale, busy } = useNative(); const r = useRoleTheme(); const [focused, setFocused] = useState(false);
  return <View style={styles.field}><Txt style={styles.label}>{label}</Txt><TextInput {...props} onFocus={e => { setFocused(true); props.onFocus?.(e); }} onBlur={e => { setFocused(false); props.onBlur?.(e); }} editable={props.editable !== false && !busy} accessibilityLabel={label} placeholderTextColor="#8A86A8" style={[styles.input, props.multiline && { minHeight: 116, textAlignVertical: "top" }, { textAlign: locale === "ar" ? "right" : "left", writingDirection: locale === "ar" ? "rtl" : "ltr" }, focused && { borderColor: r.from, shadowColor: r.from, shadowOpacity: .18, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } }, props.style, error && { borderColor: c.red }]} />{error && <Txt style={{ color: c.red }} accessibilityRole="alert">{error}</Txt>}</View>;
}
export function Select({ label, value, options, onChange, optional = false }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; optional?: boolean }) {
  const { t, busy } = useNative(); const motion = useEducationMotion(); const r = useRoleTheme(); const [open, setOpen] = useState(false); const [query, setQuery] = useState("");
  const rows = options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()));
  return <View style={styles.field}><Txt style={styles.label}>{label}</Txt><Pressable accessibilityRole="button" accessibilityLabel={label} disabled={busy} onPress={() => setOpen(true)} style={styles.input}><Txt>{options.find(o => o.value === value)?.label ?? t(optional ? "optional" : "select")}</Txt></Pressable><Modal visible={open} animationType={motion ? "slide" : "none"} onRequestClose={() => setOpen(false)}><SafeAreaView style={styles.screen}><View style={styles.modalHead}><Txt title>{label}</Txt><Button secondary onPress={() => setOpen(false)}>{t("close")}</Button></View><View style={{ paddingHorizontal: 20 }}><Field label={t("search")} value={query} onChangeText={setQuery} /></View><FlatList keyboardShouldPersistTaps="handled" data={optional ? [{ value: "", label: t("optional") }, ...rows] : rows} keyExtractor={o => o.value} renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityState={{ selected: item.value === value }} onPress={() => { onChange(item.value); setOpen(false); setQuery(""); }} style={[styles.option, item.value === value && { backgroundColor: r.soft, borderStartWidth: 4, borderStartColor: r.from }]}><Txt>{item.label}</Txt></Pressable>} ListEmptyComponent={<Txt muted style={{ padding: 20 }}>{t("noMatches")}</Txt>} /></SafeAreaView></Modal></View>;
}
export function Badge({ value }: { value: string }) {
  const { t } = useNative(); const tone = statusTones[toneForStatus(value)];
  return <View style={[styles.badge, { backgroundColor: tone.bg }]}><View style={[styles.badgeDot, { backgroundColor: tone.fg }]} /><Txt style={{ color: tone.fg, fontSize: 12, fontWeight: "700" }}>{t(value)}</Txt></View>;
}
export function Blank({ filtered = false }: { filtered?: boolean }) { const { t } = useNative(); return <Card><NativeEducationArt subject="" width={110} /><Txt title style={{ textAlign: "center" }}>{t(filtered ? "noMatches" : "empty")}</Txt><Txt muted style={{ textAlign: "center" }}>{t("emptyHelp")}</Txt></Card>; }
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background }, text: { color: c.text, fontSize: 14, lineHeight: 25 }, muted: { color: c.muted, fontSize: 12 }, title: { fontSize: 22, fontWeight: "800", lineHeight: 34 },
  content: { padding: 18, gap: 16, paddingBottom: 36 }, header: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 20, gap: 12, borderBottomStartRadius: 26, borderBottomEndRadius: 26, overflow: "hidden" }, row: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  button: { minHeight: 46, borderRadius: c.controlRadius, backgroundColor: c.primary, paddingVertical: 11, paddingHorizontal: 18, alignItems: "center", justifyContent: "center", overflow: "hidden" }, secondary: { backgroundColor: "#FFFFFF", borderWidth: 1.5, borderColor: c.border }, danger: { backgroundColor: c.red },
  card: { borderWidth: 1, borderColor: c.border, borderRadius: c.radius, padding: 20, backgroundColor: c.surface, gap: 13, marginBottom: 16, shadowOpacity: .1, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  field: { gap: 7, marginBottom: 14 }, label: { fontSize: 13, fontWeight: "700" }, input: { minHeight: 48, borderWidth: 1.5, borderColor: c.border, borderRadius: c.controlRadius, paddingHorizontal: 13, paddingVertical: 11, backgroundColor: "white", fontSize: 14, color: c.text },
  badge: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 11 }, badgeDot: { width: 6, height: 6, borderRadius: 3 },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 20 }, metric: { width: "47%", backgroundColor: "white", borderWidth: 1, borderColor: c.border, borderRadius: 22, padding: 16, borderTopWidth: 3, shadowOpacity: .14, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  metricIcon: { width: 42, height: 42, borderRadius: 14, justifyContent: "center", alignItems: "center", shadowOpacity: .4, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  tabs: { flexDirection: "row", backgroundColor: "#FFFFFF", paddingHorizontal: 8, paddingTop: 8, gap: 4, borderTopWidth: 1, borderTopColor: c.border, shadowColor: "#1B1740", shadowOpacity: .08, shadowRadius: 16, shadowOffset: { width: 0, height: -4 }, elevation: 12 }, tab: { flex: 1, minHeight: 52, borderRadius: 16, justifyContent: "center", alignItems: "center", paddingHorizontal: 3, overflow: "hidden" }, selectedTab: { backgroundColor: c.primary },
  option: { paddingVertical: 18, paddingHorizontal: 22, borderBottomWidth: 1, borderBottomColor: c.border }, modalHead: { padding: 20, gap: 12 }, notice: { backgroundColor: statusTones.success.bg, padding: 14, borderRadius: 14, marginBottom: 12 }, error: { backgroundColor: statusTones.danger.bg, borderRadius: 14, padding: 14, marginBottom: 12, gap: 10 }, sectionTitle: { marginBottom: 15, fontSize: 18, fontWeight: "800" }, divider: { height: 1, backgroundColor: c.border, marginVertical: 10 },
});
