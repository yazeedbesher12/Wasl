import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Alert, BackHandler, I18nManager } from "react-native";
import { CHILD_KEY, DemoError, LOCALE_KEY, SESSION_KEY, text } from "../../../packages/shared/src/demo";
import type { Command, LearningCommand, Locale, RecordInput, Session, Snapshot } from "../../../packages/shared/src/demo";
import { AsyncStorage, nativeStore } from "./storage";

export interface Route { page: string; id?: string; edit?: boolean; attempt?: boolean; childLinkId?: string }
interface UIState { stack: Route[]; forms: Record<string, RecordInput>; filters: Record<string, string[]> }
function useNativeState() {
  const [data, setData] = useState<Snapshot>(); const [locale, setLanguage] = useState<Locale>("ar");
  const [session, setSession] = useState<Session>({ membershipId: "" });
  const [ui, setUI] = useState<UIState>({ stack: [{ page: "entry" }], forms: {}, filters: {} });
  const [error, setError] = useState<{ code: string; field?: string }>(); const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false); const [ready, setReady] = useState(false); const [persistent, setPersistent] = useState(true);
  const [dirty, setDirty] = useState(false); const locked = useRef(false); const t = (key: string) => text(locale, key);
  const activeDraftKey = useRef("");
  const generation = useRef(0);
  const route = ui.stack[ui.stack.length - 1] ?? { page: "entry" };
  const load = useCallback(async () => { try { setData(await nativeStore.load()); setPersistent(nativeStore.persistent); } catch (e) { setError({ code: e instanceof DemoError ? e.code : "error" }); } }, []);
  useEffect(() => {
    const unsubscribe = nativeStore.subscribe(() => { setData(nativeStore.snapshot()); setPersistent(nativeStore.persistent); });
    void (async () => {
      try {
        const storedLocale = await AsyncStorage.getItem(LOCALE_KEY); const next: Locale = storedLocale === "en" ? "en" : "ar";
        setLanguage(next); I18nManager.allowRTL(true); I18nManager.forceRTL(next === "ar");
        setSession({ membershipId: await AsyncStorage.getItem(SESSION_KEY) ?? "", childLinkId: await AsyncStorage.getItem(CHILD_KEY) ?? undefined });
        const raw = await AsyncStorage.getItem("wasl.native.ui.v1");
        if (raw) { try { const parsed = JSON.parse(raw) as UIState; if (Array.isArray(parsed.stack) && parsed.stack.length > 0 && parsed.stack.every(r => typeof r.page === "string" && (r.id === undefined || typeof r.id === "string") && (r.childLinkId === undefined || typeof r.childLinkId === "string") && (r.attempt === undefined || typeof r.attempt === "boolean")) && parsed.forms && typeof parsed.forms === "object" && Object.values(parsed.forms).every(f => f && typeof f.name === "string" && typeof f.nameAr === "string" && f.values && typeof f.values === "object" && Object.values(f.values).every(v => typeof v === "string")) && parsed.filters && typeof parsed.filters === "object" && Object.values(parsed.filters).every(f => Array.isArray(f) && f.every(v => typeof v === "string"))) setUI(parsed); } catch { /* Domain data is separate and is never cleared by invalid UI preferences. */ } }
      } catch { setPersistent(false); }
      await load(); setReady(true);
    })(); return unsubscribe;
  }, [load]);
  useEffect(() => { if (ready) { const timer = setTimeout(() => { void AsyncStorage.setItem("wasl.native.ui.v1", JSON.stringify(ui)).catch(() => setPersistent(false)); }, 250); return () => clearTimeout(timer); } }, [ui, ready]);
  function guard(action: () => void) {
    if (!dirty) { action(); return; }
    Alert.alert(t("discard"), t("discardHelp"), [{ text: t("cancel"), style: "cancel" }, { text: t("confirm"), style: "destructive", onPress: () => { setDirty(false); setUI(old => { const forms = { ...old.forms }; delete forms[activeDraftKey.current]; return { ...old, forms }; }); action(); } }]);
  }
  const go = (next: Route, force = false) => {
    if (locked.current) return;
    const parent = data?.records.memberships.find(m => m.id === session.membershipId)?.values.role === "PARENT";
    const destination = parent && !["entry", "children", "profile"].includes(next.page) ? { ...next, childLinkId: next.childLinkId ?? route.childLinkId ?? session.childLinkId } : next;
    const action = () => { setError(undefined); setSuccess(""); setDirty(false); setUI(old => ({ ...old, stack: [...old.stack, destination] })); };
    if (force) action(); else guard(action);
  };
  function back() {
    if (locked.current) return true;
    if (ui.stack.length <= 1) return false;
    guard(() => { setDirty(false); setError(undefined); setUI(old => ({ ...old, stack: old.stack.slice(0, -1) })); }); return true;
  }
  useEffect(() => { const subscription = BackHandler.addEventListener("hardwareBackPress", back); return () => subscription.remove(); });
  async function setLocale(value: Locale) {
    setLanguage(value); I18nManager.allowRTL(true); I18nManager.forceRTL(value === "ar");
    try { await AsyncStorage.setItem(LOCALE_KEY, value); await AsyncStorage.setItem("wasl.native.ui.v1", JSON.stringify(ui)); } catch { setPersistent(false); }
  }
  async function selectMembership(membershipId: string) {
    generation.current++;
    const parent = data?.records.memberships.find(m => m.id === membershipId)?.values.role === "PARENT";
    setSession({ membershipId }); setDirty(false); setError(undefined); setUI({ stack: [{ page: "entry" }, { page: parent ? "children" : "dashboard" }], forms: {}, filters: {} });
    try { await AsyncStorage.setItem(SESSION_KEY, membershipId); await AsyncStorage.removeItem(CHILD_KEY); } catch { setPersistent(false); }
  }
  function selectChildLink(childLinkId: string) {
    if (session.childLinkId === childLinkId) return;
    generation.current++; setError(undefined); setSuccess(""); setSession(old => ({ ...old, childLinkId }));
    void AsyncStorage.setItem(CHILD_KEY, childLinkId).catch(() => setPersistent(false));
  }
  async function perform<T>(operation: () => Promise<T>, message = "saved"): Promise<T | undefined> {
    if (locked.current) return; const token = generation.current; locked.current = true; setBusy(true); setError(undefined); setSuccess("");
    try { const result = await operation(); if (token !== generation.current) return; setSuccess(message); return result; }
    catch (e) { if (token === generation.current) setError({ code: e instanceof DemoError ? e.code : "error", field: e instanceof DemoError ? e.field : undefined }); }
    finally { locked.current = false; setBusy(false); }
  }
  return { data, locale, setLocale, session, selectMembership, selectChildLink, ui, setUI, route, go, back, t, ready, error, setError, success, busy, persistent, load, dirty, setDirty, activeDraftKey, perform, guard,
    run: (command: Command) => perform(() => nativeStore.dispatch(session, command)),
    runLearning: (command: LearningCommand, childLinkId?: string) => perform(() => nativeStore.dispatch({ ...session, childLinkId }, command), command.type === "saveAnswers" ? "draftSaved" : command.type === "submitAnswers" ? "submittedSuccess" : "saved"),
    importData: async (raw: string) => { const result = await perform(() => nativeStore.importSnapshot(raw), "imported"); if (result) { setSession({ membershipId: "" }); setUI({ stack: [{ page: "entry" }], forms: {}, filters: {} }); generation.current++; await AsyncStorage.multiRemove([SESSION_KEY, CHILD_KEY]).catch(() => undefined); } return result; },
  };
}
const Context = createContext<ReturnType<typeof useNativeState> | null>(null);
export function NativeProvider({ children }: { children: ReactNode }) { const value = useNativeState(); return <Context.Provider value={value}>{children}</Context.Provider>; }
export function useNative() { const value = useContext(Context); if (!value) throw new Error("NativeProvider required"); return value; }
