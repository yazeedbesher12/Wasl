/** Presentation only. Coordinates are shared by SVG on web and native vector views. */
export const designTokens = {
  background: "#F0F5FF", surface: "#FFFEFC", primary: "#315DE5", tint: "#E9F0FF",
  text: "#172D57", muted: "#61718C", border: "#DCE5F4", navy: "#10264D",
  sky: "#9BD4F8", periwinkle: "#B9C6FF", yellow: "#FFD875", mint: "#A9E4D1",
  green: "#23734A", amber: "#895615", red: "#B33838", radius: 22, controlRadius: 13,
} as const;
export const educationMotion = { press: 180, reveal: 380, welcomeHalfCycle: 8500, backgroundHalfCycle: 10000 } as const;
export type ArtTheme = "math" | "chemistry" | "biology" | "physics" | "languages" | "computing" | "generic";
export type WelcomeTheme = "student" | "teacher" | "school" | "parent" | "platform" | "entry";
export type VectorShape = { type: "rect" | "ellipse" | "line" | "text"; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; weight?: number; radius?: number; rotate?: number; text?: string };
const c = designTokens;
const box = (x: number, y: number, w: number, h: number, fill: string, radius = 6, rotate = 0, stroke?: string): VectorShape => ({ type: "rect", x, y, w, h, fill, radius, rotate, stroke });
const oval = (x: number, y: number, w: number, h: number, fill: string, stroke?: string, rotate = 0): VectorShape => ({ type: "ellipse", x, y, w, h, fill, stroke, rotate });
const line = (x: number, y: number, w: number, h: number, stroke: string = c.primary, weight = 3): VectorShape => ({ type: "line", x, y, w, h, stroke, weight });
const glyph = (text: string, x: number, y: number, size: number, fill: string = c.primary): VectorShape => ({ type: "text", text, x, y, w: size, h: size, fill });
/** Classifies actual subject labels; unfamiliar school-defined subjects keep a neutral book. */
export function subjectTheme(name: string): ArtTheme {
  if (/math|رياض|حساب|جبر|هندس/i.test(name)) return "math";
  if (/chem|كيمي/i.test(name)) return "chemistry";
  if (/bio|أحياء|احياء|حيات|نبات/i.test(name)) return "biology";
  if (/phys|فيزي/i.test(name)) return "physics";
  if (/arab|english|language|عرب|إنج|انج|لغة|لغات/i.test(name)) return "languages";
  if (/comput|tech|code|حاس|تقني|تكنول|برمج/i.test(name)) return "computing";
  return "generic";
}
function book(x: number, y: number, scale = 1): VectorShape[] {
  return [box(x + 4, y + 6, 88 * scale, 66 * scale, c.periwinkle, 8), box(x, y, 88 * scale, 64 * scale, "#FFFFFF", 6, 0, c.primary), line(x + 44 * scale, y + 3, 0, 57 * scale), ...[17, 28, 39].flatMap(d => [line(x + 10 * scale, y + d * scale, 24 * scale, 0, "#9FB5E8", 2), line(x + 54 * scale, y + d * scale, 24 * scale, 0, "#9FB5E8", 2)])];
}
function school(x: number, y: number, s = 1): VectorShape[] {
  return [box(x, y + 20 * s, 92 * s, 68 * s, "#FFFFFF", 5, 0, c.primary), box(x + 30 * s, y, 32 * s, 88 * s, c.sky, 4, 0, c.primary), box(x + 38 * s, y + 60 * s, 16 * s, 28 * s, c.primary, 3), oval(x + 38 * s, y + 12 * s, 16 * s, 16 * s, "#FFFFFF", c.primary), ...[12, 68].flatMap(a => [box(x + a * s, y + 35 * s, 13 * s, 13 * s, c.periwinkle, 2), box(x + a * s, y + 58 * s, 13 * s, 13 * s, c.periwinkle, 2)]), line(x - 8 * s, y + 90 * s, 108 * s, 0)];
}
export function subjectShapes(theme: ArtTheme): VectorShape[] {
  const base = [oval(8, 12, 144, 138, "#E7EEFF"), oval(26, 134, 110, 12, "#CBD9F7"), oval(125, 21, 17, 17, c.yellow), line(16, 40, 10, 0, c.sky), line(21, 35, 0, 10, c.sky)];
  let art: VectorShape[];
  switch (theme) {
    case "math": art = [box(41, 35, 77, 95, c.primary, 12, -8), box(49, 41, 59, 28, "#FFFFFF", 5, -8), ...[0, 1, 2].flatMap(r => [0, 1, 2].map(k => box(52 + k * 18, 80 + r * 14, 11, 8, r === 2 && k === 2 ? c.yellow : c.sky, 2))), glyph("+", 56, 39, 24), line(25, 105, 30, 24, c.navy, 4), line(25, 105, -3, 29, c.navy, 4), line(22, 134, 33, -5, c.navy, 4)]; break;
    case "chemistry": art = [box(64, 32, 30, 12, c.primary, 4), line(69, 44, 0, 30), line(89, 44, 0, 30), line(69, 74, -27, 47), line(89, 74, 27, 47), box(42, 109, 74, 21, c.sky, 10, 0, c.primary), line(42, 121, 74, 0), oval(61, 95, 12, 12, c.mint), oval(83, 111, 8, 8, "#FFFFFF"), oval(100, 50, 12, 12, "#FFFFFF", c.primary), oval(112, 37, 7, 7, c.sky)]; break;
    case "biology": art = Array.from({ length: 9 }, (_, i) => { const x = Math.sin(i * .62) * 27; return [line(80 + x, 31 + i * 12, -x * 2, 0, i % 2 ? c.sky : c.primary, 4), oval(76 + x, 27 + i * 12, 8, 8, c.primary), oval(76 - x, 27 + i * 12, 8, 8, i % 2 ? c.mint : c.sky)]; }).flat(); break;
    case "physics": art = [oval(29, 57, 104, 44, "transparent", c.primary), oval(29, 57, 104, 44, "transparent", c.primary, 60), oval(29, 57, 104, 44, "transparent", c.primary, -60), oval(69, 67, 24, 24, c.primary), oval(28, 72, 12, 12, c.yellow), oval(98, 108, 12, 12, c.sky)]; break;
    case "languages": art = [box(29, 39, 76, 61, c.primary, 13, -6), box(64, 75, 66, 51, "#FFFFFF", 13, 7, c.primary), glyph("A", 47, 43, 33, "#FFFFFF"), glyph("ع", 85, 77, 32), line(39, 99, 0, 11, c.primary, 6), line(113, 121, 0, 10, c.primary, 4)]; break;
    case "computing": art = [box(29, 38, 104, 75, c.primary, 9), box(36, 45, 90, 59, "#FFFFFF", 4), line(69, 63, -12, 12), line(57, 75, 12, 12), line(94, 63, 12, 12), line(106, 75, -12, 12), line(88, 59, -10, 32, c.sky), box(71, 113, 20, 13, c.periwinkle, 1), box(53, 126, 57, 6, c.primary, 3)]; break;
    default: art = book(35, 52);
  }
  return [...base, ...art, oval(22, 117, 9, 9, c.mint)];
}
export function welcomeShapes(theme: WelcomeTheme): VectorShape[] {
  const shapes: VectorShape[] = [oval(72, 22, 260, 196, "#DCE9FF"), oval(40, 204, 302, 16, "#C4D7FA"), oval(317, 35, 23, 23, c.yellow), oval(47, 135, 15, 15, c.mint), line(338, 139, 18, 0, c.primary, 2), line(347, 130, 0, 18, c.primary, 2), box(44, 65, 38, 46, "#FFFFFF", 10, -12, "#B4C9EF"), line(53, 81, 19, 0, c.primary, 2), line(53, 90, 13, 0, c.primary, 2)];
  if (theme === "school" || theme === "platform") {
    shapes.push(...school(144, 85, 1.15), ...book(67, 163, .6), line(119, 92, 25, 20, "#9EBBEF", 2), line(251, 115, 28, -29, "#9EBBEF", 2));
    if (theme === "platform") shapes.push(...school(279, 49, .55), ...school(73, 45, .45));
    else shapes.push(box(277, 66, 42, 58, c.primary, 6, 12), line(287, 82, 20, 0, "#FFFFFF"), line(287, 93, 16, 0, c.sky));
  } else if (theme === "teacher") {
    shapes.push(box(110, 50, 179, 111, c.primary, 12), box(119, 59, 161, 89, "#FFFFFF", 6), line(145, 82, 103, 0, "#A6BFF4", 4), line(145, 99, 70, 0, "#A6BFF4", 4), line(145, 117, 83, 0, "#A6BFF4", 4), line(140, 163, -14, 37, c.navy, 5), line(260, 163, 14, 37, c.navy, 5), ...book(192, 155, .85), box(83, 123, 54, 64, c.yellow, 7, -12), line(94, 141, 30, 0, c.navy, 2));
  } else {
    shapes.push(box(111, 132, 152, 26, c.primary, 7, -5), box(121, 158, 155, 25, c.sky, 6, 3), box(111, 183, 163, 24, c.periwinkle, 6), ...book(136, 73, 1.04), box(292, 88, 13, 106, c.yellow, 3, 20, c.navy), line(283, 187, 0, 12, c.navy, 4), oval(72, 40, 57, 57, c.sky, c.primary), oval(89, 40, 22, 57, "transparent", c.primary), line(73, 68, 54, 0), line(100, 99, 0, 21), line(83, 121, 34, 0));
    if (theme === "parent") shapes.push(oval(267, 32, 44, 44, c.mint), line(277, 52, 8, 8, c.navy), line(285, 60, 16, -19, c.navy));
  }
  return shapes;
}
export const navPaths: Record<string, string> = {
  dashboard: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  classes: "M3 5q5-3 9 0q4-3 9 0v15q-5-3-9 0q-4-3-9 0zM12 5v15",
  academics: "M2 9l10-6 10 6-10 6zM5 11v7q7 5 14 0v-7",
  memberships: "M16 21v-3q0-4-5-4H7q-5 0-5 4v3M13 6a4 4 0 1 1-8 0a4 4 0 1 1 8 0M17 4q5 2 0 6M19 14q3 1 3 5v2",
  notifications: "M5 16V9a7 7 0 0 1 14 0v7l2 3H3zM10 22h4",
  settings: "M3 6h18M3 12h18M3 18h18M8 3v6M16 9v6M10 15v6",
  announcements: "M3 10v5h5l11 5V5L8 10zM8 15l2 7",
  results: "M4 21h16M7 17v-5M12 17V4M17 17V8",
  tasks: "M6 4h12v17H6zM9 2h6v4H9zM9 10h6M9 14h6M9 18h3",
  children: "M3 21v-3q0-5 6-5t6 5v3M9 3a4 4 0 1 1 0 8a4 4 0 1 1 0-8M17 12q4 0 4 5v4M17 4a3 3 0 0 1 0 6",
};
export function navigationPath(page: string): string { return navPaths[page] ?? (/lesson|unit|subject|resource|bank|question/.test(page) ? navPaths.classes : /user|enroll|link|profile/.test(page) ? navPaths.memberships : /grade|submission/.test(page) ? navPaths.results : /setting|preference|transfer/.test(page) ? navPaths.settings : navPaths.tasks); }
export function navigationGroup(page: string): string {
  return page === "dashboard" || page === "children" ? "navWorkspace" : ["notifications", "announcements", "activity", "settings", "profile", "transfer"].includes(page) ? "navAccount" : ["users", "memberships", "academics", "links"].includes(page) ? "navManage" : "navLearning";
}
