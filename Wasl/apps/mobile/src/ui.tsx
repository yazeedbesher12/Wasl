import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Animated, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { TextInputProps, TextProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { designTokens as c, educationMotion } from "../../../packages/shared/src/demo";
import { useNative } from "./context";
import { NativeEducationArt, useEducationMotion } from "./education";


export function Txt({ children, muted, title, ltr, style, ...props }: TextProps & { children?: ReactNode; muted?: boolean; title?: boolean; ltr?: boolean }) {
  const { locale } = useNative();
  return <Text {...props} style={[styles.text, { textAlign: ltr ? "left" : locale === "ar" ? "right" : "left", writingDirection: ltr ? "ltr" : locale === "ar" ? "rtl" : "ltr" }, muted && styles.muted, title && styles.title, style]}>{children}</Text>;
}
export function Button({ children, onPress, secondary = false, danger = false, disabled = false }: { children: ReactNode; onPress: () => void; secondary?: boolean; danger?: boolean; disabled?: boolean }) {
  const { busy } = useNative(); disabled = disabled || busy;
  const enabled = useEducationMotion(); const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => { if (!enabled) { scale.stopAnimation(); scale.setValue(1); } }, [enabled, scale]);
  const press = (toValue: number) => { Animated.timing(scale, { toValue: enabled ? toValue : 1, duration: educationMotion.press, useNativeDriver: true }).start(); };
  return <Animated.View style={{ transform: [{ scale }] }}><Pressable accessibilityRole="button" onPressIn={() => press(.98)} onPressOut={() => press(1)} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, secondary && styles.secondary, danger && styles.danger, (disabled || pressed) && { opacity: .55 }]}><Txt style={{ color: secondary ? c.primary : "#fff", textAlign: "center", fontWeight: "600" }}>{children}</Txt></Pressable></Animated.View>;
}
export function Card({ children, accent = false }: { children: ReactNode; accent?: boolean }) { return <View style={[styles.card, accent && { borderStartWidth: 3, borderStartColor: "#AFC5FA" }]}>{children}</View>; }
export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string }) {
  const { locale, busy } = useNative();
  return <View style={styles.field}><Txt style={styles.label}>{label}</Txt><TextInput {...props} editable={props.editable !== false && !busy} accessibilityLabel={label} placeholderTextColor="#718096" style={[styles.input, props.multiline && { minHeight: 116, textAlignVertical: "top" }, { textAlign: locale === "ar" ? "right" : "left", writingDirection: locale === "ar" ? "rtl" : "ltr" }, props.style, error && { borderColor: c.red }]} />{error && <Txt style={{ color: c.red }} accessibilityRole="alert">{error}</Txt>}</View>;
}
export function Select({ label, value, options, onChange, optional = false }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; optional?: boolean }) {
  const { t, busy } = useNative(); const motion = useEducationMotion(); const [open, setOpen] = useState(false); const [query, setQuery] = useState("");
  const rows = options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()));
  return <View style={styles.field}><Txt style={styles.label}>{label}</Txt><Pressable accessibilityRole="button" accessibilityLabel={label} disabled={busy} onPress={() => setOpen(true)} style={styles.input}><Txt>{options.find(o => o.value === value)?.label ?? t(optional ? "optional" : "select")}</Txt></Pressable><Modal visible={open} animationType={motion ? "slide" : "none"} onRequestClose={() => setOpen(false)}><SafeAreaView style={styles.screen}><View style={styles.modalHead}><Txt title>{label}</Txt><Button secondary onPress={() => setOpen(false)}>{t("close")}</Button></View><View style={{ paddingHorizontal: 20 }}><Field label={t("search")} value={query} onChangeText={setQuery} /></View><FlatList keyboardShouldPersistTaps="handled" data={optional ? [{ value: "", label: t("optional") }, ...rows] : rows} keyExtractor={o => o.value} renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityState={{ selected: item.value === value }} onPress={() => { onChange(item.value); setOpen(false); setQuery(""); }} style={[styles.option, item.value === value && { backgroundColor: c.tint }]}><Txt>{item.label}</Txt></Pressable>} ListEmptyComponent={<Txt muted style={{ padding: 20 }}>{t("noMatches")}</Txt>} /></SafeAreaView></Modal></View>;
}
export function Badge({ value }: { value: string }) { const { t } = useNative(); const positive = ["active", "approved", "published", "released"].includes(value); return <View style={[styles.badge, positive && { backgroundColor: "#EAF5EE" }]}><Txt style={{ color: positive ? c.green : c.muted, fontSize: 12 }}>{t(value)}</Txt></View>; }
export function Blank({ filtered = false }: { filtered?: boolean }) { const { t } = useNative(); return <Card><NativeEducationArt subject="" width={88} /><Txt title>{t(filtered ? "noMatches" : "empty")}</Txt><Txt muted>{t("emptyHelp")}</Txt></Card>; }
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background }, text: { color: c.text, fontSize: 14, lineHeight: 25 }, muted: { color: c.muted, fontSize: 12 }, title: { fontSize: 21, fontWeight: "700", lineHeight: 33 },
  content: { padding: 18, gap: 16, paddingBottom: 30 }, header: { backgroundColor: c.navy, borderBottomWidth: 1, borderBottomColor: "#263E67", padding: 16, gap: 12 }, row: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  button: { minHeight: 46, borderRadius: c.controlRadius, backgroundColor: c.primary, paddingVertical: 11, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" }, secondary: { backgroundColor: c.tint, borderWidth: 1, borderColor: "#D3E0FC" }, danger: { backgroundColor: c.red }, card: { borderWidth: 1, borderColor: c.border, borderRadius: c.radius, padding: 20, backgroundColor: c.surface, gap: 13, marginBottom: 16, shadowColor: "#274675", shadowOpacity: .035, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
  field: { gap: 7, marginBottom: 14 }, label: { fontSize: 13, fontWeight: "600" }, input: { minHeight: 48, borderWidth: 1, borderColor: "#D5DDE9", borderRadius: c.controlRadius, paddingHorizontal: 13, paddingVertical: 11, backgroundColor: "white", fontSize: 14, color: c.text },
  badge: { alignSelf: "flex-start", borderRadius: 8, paddingVertical: 3, paddingHorizontal: 9, backgroundColor: "#EFF2F7" }, metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 20 }, metric: { width: "47%", backgroundColor: "white", borderWidth: 1, borderColor: c.border, borderRadius: 18, padding: 18, gap: 10, borderTopWidth: 3, borderTopColor: "#BCD0FD" },
  tabs: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#263E67", backgroundColor: c.navy, paddingHorizontal: 6, paddingVertical: 8, gap: 4 }, tab: { flex: 1, minHeight: 48, borderRadius: 12, justifyContent: "center", paddingHorizontal: 3 }, selectedTab: { backgroundColor: c.primary },
  option: { paddingVertical: 18, paddingHorizontal: 22, borderBottomWidth: 1, borderBottomColor: c.border }, modalHead: { padding: 20, gap: 12 }, notice: { backgroundColor: c.tint, padding: 14, borderRadius: 12, marginBottom: 12 }, error: { backgroundColor: "#FFF0ED", borderRadius: 12, padding: 14, marginBottom: 12 }, sectionTitle: { marginBottom: 15, fontSize: 17, fontWeight: "700" }, divider: { height: 1, backgroundColor: c.border, marginVertical: 10 },
});
