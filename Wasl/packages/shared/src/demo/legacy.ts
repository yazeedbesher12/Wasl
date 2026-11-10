import type { LegacyState as DemoState, School } from "./model";


const rows = [
  ["Al Nour School", "مدرسة النور", "Nablus", "نابلس", "Lina Khalil", "لينا خليل"],
  ["Al Amal Academy", "أكاديمية الأمل", "Ramallah", "رام الله", "Omar Saleh", "عمر صالح"],
  ["Olive Grove School", "مدرسة الزيتون", "Jenin", "جنين", "Hala Nasser", "هالة ناصر"],
  ["Al Bayan School", "مدرسة البيان", "Hebron", "الخليل", "Sami Hamdan", "سامي حمدان"],
  ["Horizons Academy", "أكاديمية آفاق", "Bethlehem", "بيت لحم", "Rana Awad", "رنا عوض"],
  ["Al Manara School", "مدرسة المنارة", "Tulkarm", "طولكرم", "Nour Abbas", "نور عباس"],
  ["Spring School", "مدرسة الربيع", "Nablus", "نابلس", "Adam Mansour", "آدم منصور"],
  ["Al Qalam Academy", "أكاديمية القلم", "Ramallah", "رام الله", "Maya Issa", "مايا عيسى"],
  ["Al Safa School", "مدرسة الصفا", "Jericho", "أريحا", "Tariq Ali", "طارق علي"],
  ["Tomorrow School", "مدرسة الغد", "Jenin", "جنين", "Dima Hassan", "ديما حسن"],
  ["Al Rawda School", "مدرسة الروضة", "Qalqilya", "قلقيلية", "Yara Saad", "يارا سعد"],
  ["Cedar Academy", "أكاديمية الأرز", "Hebron", "الخليل", "Kareem Zaid", "كريم زيد"],
  ["Al Hikma School", "مدرسة الحكمة", "Bethlehem", "بيت لحم", "Salma Adel", "سلمى عادل"],
  ["Al Waha School", "مدرسة الواحة", "Jericho", "أريحا", "Rami Omar", "رامي عمر"],
];

export function seedLegacy(): DemoState {
  const schools: School[] = rows.map(([name, nameAr, city, cityAr, administrator, administratorAr], i) => ({
    id: `school-${i + 1}`, name, nameAr, locale: "ar", active: i !== 3 && i !== 8 && i !== 12,
    createdAt: new Date(Date.UTC(2026, 8, 1 + i * 4, 8)).toISOString(),
    demo: { city, cityAr, administrator, administratorAr, email: `office${i + 1}@example.com`, students: 180 + i * 37, teachers: 16 + i * 3 },
  }));
  const activity: DemoState["activity"] = schools.flatMap(s => [
    { id: `created-${s.id}`, schoolId: s.id, action: "created" as const, actor: "Demo administrator", actorAr: "مدير العرض التجريبي", at: s.createdAt },
    ...(!s.active ? [{ id: `suspended-${s.id}`, schoolId: s.id, action: "suspended" as const, actor: "Demo administrator", actorAr: "مدير العرض التجريبي", at: new Date(Date.parse(s.createdAt) + 86400000).toISOString() }] : []),
  ]).sort((a, b) => b.at.localeCompare(a.at));
  return { version: 1, schools, activity, administrator: { name: "Nour Mansour", nameAr: "نور منصور", email: "admin@example.com" } };
}

const object = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
const strings = (o: Record<string, unknown>, keys: string[]) => keys.every(k => typeof o[k] === "string" && (o[k] as string).trim().length > 0);
const validDate = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
export function validLegacy(value: unknown): value is DemoState {
  if (!object(value) || value.version !== 1 || !Array.isArray(value.schools) || !Array.isArray(value.activity) || !object(value.administrator)) return false;
  if (!strings(value.administrator, ["name", "nameAr", "email"])) return false;
  const ids = new Set<string>();
  for (const s of value.schools) {
    if (!object(s) || !strings(s, ["id", "name", "nameAr"]) || typeof s.active !== "boolean" || !["ar", "en"].includes(String(s.locale)) || !validDate(s.createdAt) || !object(s.demo)) return false;
    if (ids.has(s.id as string)) return false;
    ids.add(s.id as string);
    if (!strings(s.demo, ["city", "cityAr", "administrator", "administratorAr", "email"]) || ![s.demo.students, s.demo.teachers].every(n => typeof n === "number" && Number.isSafeInteger(n) && n >= 0)) return false;
  }
  const activityIds = new Set<string>();
  return value.activity.every(a => {
    if (!object(a) || !strings(a, ["id", "schoolId", "actor", "actorAr"]) || !ids.has(a.schoolId as string) || !["created", "edited", "suspended", "reactivated"].includes(String(a.action)) || !validDate(a.at) || activityIds.has(a.id as string)) return false;
    activityIds.add(a.id as string);
    return true;
  });
}

