import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { ReduceMotion, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { designTokens as c } from "../../../packages/shared/src/demo";
import { NativeNavIcon, useEducationMotion } from "./education";
import { Gradient, haptic, screenEnter, useRoleTheme } from "./theme";
import { usePresentation } from "./presentation";

/** Role-gradient header that extends under the status bar. */
export function ShellHeader({ children }: { children: ReactNode }) {
  const r = useRoleTheme(); const insets = useSafeAreaInsets();
  return <Gradient colors={[r.from, r.to]} style={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 20, gap: 12, borderBottomStartRadius: 26, borderBottomEndRadius: 26, overflow: "hidden", shadowColor: r.from, shadowOpacity: .3, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8, zIndex: 2 }}>
    <View pointerEvents="none" style={{ position: "absolute", width: 220, height: 220, borderRadius: 110, backgroundColor: "rgba(255,255,255,0.12)", end: -70, top: -110 }} />
    <View pointerEvents="none" style={{ position: "absolute", width: 120, height: 120, borderRadius: 60, borderWidth: 2, borderStyle: "dashed", borderColor: "rgba(255,255,255,0.22)", start: -40, bottom: -50 }} />
    {children}
  </Gradient>;
}
/** Small pill used for language toggles inside the gradient header. */
export function HeaderPill({ label, selected, onPress, disabled: off = false }: { label: string; selected: boolean; onPress: () => void; disabled?: boolean }) {
  const { busy } = usePresentation(); const disabled = off || busy;
  return <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled }} disabled={disabled} onPress={() => { haptic(); onPress(); }} style={({ pressed }) => ({ minHeight: 38, paddingHorizontal: 14, borderRadius: 12, justifyContent: "center", backgroundColor: selected ? "#FFFFFF" : pressed ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.16)" })}>
    <HeaderPillText selected={selected}>{label}</HeaderPillText>
  </Pressable>;
}
function HeaderPillText({ selected, children }: { selected: boolean; children: ReactNode }) {
  const r = useRoleTheme();
  return <Text style={{ color: selected ? r.from : "#FFFFFF", fontWeight: "700", fontSize: 13 }}>{children}</Text>;
}
/** Bottom tabs with a springy gradient pill on the selected tab. Accessible name is the label. */
export function TabBar({ tabs, selected, onSelect, disabled }: { tabs: { page: string; label: string }[]; selected: string; onSelect: (page: string) => void; disabled?: boolean }) {
  const r = useRoleTheme(); const insets = useSafeAreaInsets(); const enabled = useEducationMotion();
  return <View style={{ flexDirection: "row", backgroundColor: "#FFFFFF", paddingHorizontal: 8, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 8), gap: 4, borderTopStartRadius: 24, borderTopEndRadius: 24, shadowColor: "#1B1740", shadowOpacity: .1, shadowRadius: 18, shadowOffset: { width: 0, height: -6 }, elevation: 14 }}>
    {tabs.map(tab => {
      const on = tab.page === selected;
      return <Pressable key={tab.page} accessibilityRole="button" accessibilityState={{ selected: on, disabled }} disabled={disabled} onPress={() => { haptic(); onSelect(tab.page); }} style={{ flex: 1, minHeight: 56, borderRadius: 18, justifyContent: "center", alignItems: "center", paddingHorizontal: 3, overflow: "hidden" }}>
        {on && <Animated.View key={selected} entering={enabled ? ZoomIn.springify().damping(14).reduceMotion(ReduceMotion.System) : undefined} style={{ position: "absolute", top: 0, bottom: 0, start: 0, end: 0, borderRadius: 18, overflow: "hidden" }}>
          <Gradient colors={[r.from, r.to]} style={{ flex: 1 }} />
        </Animated.View>}
        <NativeNavIcon page={tab.page} selected={on} color={on ? "#FFFFFF" : c.muted} />
        <Text numberOfLines={1} style={{ textAlign: "center", fontSize: 11, fontWeight: "700", color: on ? "#FFFFFF" : c.muted, marginTop: 4 }}>{tab.label}</Text>
      </Pressable>;
    })}
  </View>;
}
/** Re-enters content whenever the screen key changes. */
export function ScreenTransition({ children }: { children: ReactNode }) {
  const enabled = useEducationMotion();
  return <Animated.View entering={screenEnter(enabled)} style={{ gap: 16 }}>{children}</Animated.View>;
}
/** Bottom safe-area filler when no tab bar is shown. */
export function BottomInset() { const insets = useSafeAreaInsets(); return <View style={{ height: insets.bottom, backgroundColor: c.background }} />; }
