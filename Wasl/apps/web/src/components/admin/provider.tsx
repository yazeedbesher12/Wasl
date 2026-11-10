"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ar, en, type Message } from "@/lib/admin/i18n";
import type { DemoState, Locale, SchoolInput } from "@/lib/admin/model";
import { connectedDemo, demoRepository } from "@/lib/admin/repository";

function useAdminState() {
  const [locale, setLocaleState] = useState<Locale>("ar");
  const [data, setData] = useState<DemoState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [persistent, setPersistent] = useState(true);
  const [recovered, setRecovered] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [notice, setNotice] = useState<{ key: Message; error?: boolean } | null>(null);
  const t = (key: Message): string => (locale === "ar" ? ar : en)[key];
  const load = useCallback(async () => {
    setLoadError(false);
    try { const result = await demoRepository.load(); setData(result.state); setPersistent(result.persistent); setRecovered(result.recovered); }
    catch { setLoadError(true); }
  }, []);
  useEffect(() => {
    try { if (localStorage.getItem("wasl.locale") === "en") setLocaleState("en"); } catch { /* Arabic remains the safe default. */ }
    void load();
    return connectedDemo.subscribe(() => { const state = connectedDemo.snapshot(); if (state) { setData(state); setPersistent(connectedDemo.persistent); } });
  }, [load]);
  useEffect(() => { document.documentElement.lang = locale; document.documentElement.dir = locale === "ar" ? "rtl" : "ltr"; }, [locale]);
  useEffect(() => { if (notice && !notice.error) { const timer = setTimeout(() => setNotice(null), 5000); return () => clearTimeout(timer); } }, [notice]);
  const setLocale = (value: Locale) => {
    setLocaleState(value);
    try { localStorage.setItem("wasl.locale", value); } catch { setPersistent(false); }
  };
  async function mutate<T extends { state: DemoState; persistent: boolean }>(operation: () => Promise<T>, success: Message): Promise<T | null> {
    if (locked.current) return null;
    locked.current = true; setBusy(true); setNotice(null);
    try { const result = await operation(); setData(result.state); setPersistent(result.persistent); setNotice({ key: success }); return result; }
    catch { setNotice({ key: "error", error: true }); return null; }
    finally { locked.current = false; setBusy(false); }
  }
  return {
    locale, setLocale, t, data, loadError, load, persistent, recovered, busy, notice, dismiss: () => setNotice(null),
    schoolName: (s: { name: string; nameAr: string }) => locale === "ar" ? s.nameAr : s.name,
    number: (n: number) => new Intl.NumberFormat(locale === "ar" ? "ar-PS" : "en-GB").format(n),
    date: (value: string, time = false) => new Intl.DateTimeFormat(locale === "ar" ? "ar-PS" : "en-GB", { dateStyle: "medium", ...(time ? { timeStyle: "short" as const } : {}), timeZone: "Asia/Jerusalem" }).format(new Date(value)),
    saveSchool: (input: SchoolInput, schoolId?: string) => mutate(() => demoRepository.saveSchool(input, schoolId), schoolId ? "saved" : "schoolCreated"),
    setActive: (schoolId: string, active: boolean) => mutate(() => demoRepository.setActive(schoolId, active), active ? "reactivatedSuccess" : "suspendedSuccess"),
    saveAdministrator: (input: DemoState["administrator"]) => mutate(() => demoRepository.saveAdministrator(input), "saved"),
    reset: () => mutate(() => demoRepository.reset(), "resetSuccess"),
  };
}
type AdminContext = ReturnType<typeof useAdminState>;
const Context = createContext<AdminContext | null>(null);
export function AdminProvider({ children }: { children: ReactNode }) {
  const value = useAdminState();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAdmin() {
  const value = useContext(Context);
  if (!value) throw new Error("AdminProvider required");
  return value;
}
