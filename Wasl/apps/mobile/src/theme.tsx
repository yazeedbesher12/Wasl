import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import type { StyleProp, ViewStyle } from "react-native";
import { FadeIn, FadeInDown, FadeOut, ReduceMotion } from "react-native-reanimated";
import { educationMotion, roleTheme, roleThemes } from "../../../packages/shared/src/demo";
import type { RoleTheme } from "../../../packages/shared/src/demo";

/** Presentation-only role colour context; shells provide the active role. */
const ThemeContext = createContext<RoleTheme>(roleThemes.platform);
export function RoleThemeProvider({ role, children }: { role: string | null | undefined; children: ReactNode }) {
  return <ThemeContext.Provider value={roleTheme(role)}>{children}</ThemeContext.Provider>;
}
export function useRoleTheme() { return useContext(ThemeContext); }
export const rgba = (rgb: string, alpha: number) => `rgba(${rgb},${alpha})`;
/** Light selection haptic; silently unavailable on web/unsupported devices. */
export function haptic() { void Haptics.selectionAsync().catch(() => { /* Haptics are optional. */ }); }

export function Gradient({ colors, style, children, angle = "diagonal" }: { colors: readonly [string, string, ...string[]]; style?: StyleProp<ViewStyle>; children?: ReactNode; angle?: "diagonal" | "vertical" }) {
  return <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={angle === "vertical" ? { x: 0, y: 1 } : { x: 1, y: 1 }} style={style}>{children}</LinearGradient>;
}
export function RoleGradient({ style, children }: { style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const r = useRoleTheme();
  return <Gradient colors={[r.from, r.to]} style={style}>{children}</Gradient>;
}

/** Entering animations; ReduceMotion.System keeps them static when the OS asks. Pass `enabled` from useEducationMotion. */
export function enterAt(index: number, enabled: boolean) {
  if (!enabled) return undefined;
  return FadeInDown.delay(Math.min(index, 10) * educationMotion.stagger).springify().damping(18).stiffness(160).reduceMotion(ReduceMotion.System);
}
export function screenEnter(enabled: boolean) { return enabled ? FadeInDown.duration(educationMotion.reveal).reduceMotion(ReduceMotion.System) : undefined; }
export function fadeIn(enabled: boolean) { return enabled ? FadeIn.duration(260).reduceMotion(ReduceMotion.System) : undefined; }
export function fadeOut(enabled: boolean) { return enabled ? FadeOut.duration(160).reduceMotion(ReduceMotion.System) : undefined; }
