"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CHILD_KEY, DemoError, LOCALE_KEY, SESSION_KEY, text } from "@wasl/shared/demo";
import type { Command, LearningCommand, Locale, RecordInput, Session, Snapshot } from "@wasl/shared/demo";
import { connectedDemo } from "@/lib/admin/repository";

function useWorkspaceState() {
  const router = useRouter();
  const [data, setData] = useState<Snapshot>();
  const [locale, setLanguage] = useState<Locale>("ar");
  const [session, setSession] = useState<Session>({ membershipId: "" });
  const [error, setError] = useState<{ code: string; field?: string }>();
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [persistent, setPersistent] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [pendingHref, setPendingHref] = useState("");
  const drafts = useRef<Record<string, RecordInput>>({});
  const draftKey = useRef("");
  const lock = useRef(false);
  const generation = useRef(0);
  const t = (key: string) => text(locale, key);
  const load = useCallback(async () => {
    try { setError(undefined); setData(await connectedDemo.load()); setPersistent(connectedDemo.persistent); }
    catch (e) { setError({ code: e instanceof DemoError ? e.code : "error" }); }
  }, []);
  useEffect(() => {
    try { setLanguage(localStorage.getItem(LOCALE_KEY) === "en" ? "en" : "ar"); setSession({ membershipId: localStorage.getItem(SESSION_KEY) ?? "", childLinkId: localStorage.getItem(CHILD_KEY) ?? undefined }); } catch { setPersistent(false); }
    const unsubscribe = connectedDemo.subscribe(() => { setData(connectedDemo.snapshot()); setPersistent(connectedDemo.persistent); });
    void load(); return unsubscribe;
  }, [load]);
  useEffect(() => { document.documentElement.lang = locale; document.documentElement.dir = locale === "ar" ? "rtl" : "ltr"; }, [locale]);
  const discardDraft = useCallback(() => {
    delete drafts.current[draftKey.current]; setDirty(false);
    if (draftKey.current.startsWith("attempt:")) { try { sessionStorage.removeItem(`wasl.${draftKey.current}`); } catch { /* Saved domain answers are independent of this UI cache. */ } }
  }, []);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    const pop = () => { if (dirty) { if (!window.confirm(text(locale, "discardHelp"))) window.history.go(1); else discardDraft(); } };
    window.addEventListener("beforeunload", unload); window.addEventListener("popstate", pop);
    return () => { window.removeEventListener("beforeunload", unload); window.removeEventListener("popstate", pop); };
  }, [dirty, locale, discardDraft]);
  const navigate = (href: string, force = false) => { if (dirty && !force) setPendingHref(href); else router.push(href); };
  function setLocale(value: Locale) { setLanguage(value); try { localStorage.setItem(LOCALE_KEY, value); } catch { setPersistent(false); } }
  function selectMembership(membershipId: string) {
    generation.current++;
    discardDraft(); drafts.current = {}; setError(undefined); setSuccess(""); setSession({ membershipId });
    try { localStorage.setItem(SESSION_KEY, membershipId); localStorage.removeItem(CHILD_KEY); } catch { setPersistent(false); }
  }
  function selectChildLink(childLinkId: string) {
    if (session.childLinkId === childLinkId) return;
    generation.current++; setError(undefined); setSuccess(""); setSession(old => ({ ...old, childLinkId }));
    try { localStorage.setItem(CHILD_KEY, childLinkId); } catch { setPersistent(false); }
  }
  async function perform<T>(operation: () => Promise<T>, message = "saved"): Promise<T | undefined> {
    if (lock.current) return;
    const token = generation.current;
    lock.current = true; setBusy(true); setError(undefined); setSuccess("");
    try { const result = await operation(); if (token !== generation.current) return; setSuccess(message); return result; }
    catch (e) { if (token === generation.current) setError({ code: e instanceof DemoError ? e.code : "error", field: e instanceof DemoError ? e.field : undefined }); }
    finally { lock.current = false; setBusy(false); }
  }
  return { data, locale, setLocale, session, selectMembership, selectChildLink, t, error, setError, success, busy, persistent, load, dirty, setDirty, drafts, draftKey, navigate, pendingHref, setPendingHref, discardDraft, perform,
    run: (command: Command) => perform(() => connectedDemo.dispatch(session, command)),
    runLearning: (command: LearningCommand, childLinkId?: string) => perform(() => connectedDemo.dispatch({ ...session, childLinkId }, command), command.type === "saveAnswers" ? "draftSaved" : command.type === "submitAnswers" ? "submittedSuccess" : "saved"),
    importData: async (raw: string) => { const result = await perform(() => connectedDemo.importSnapshot(raw), "imported"); if (result) { selectMembership(""); try { for (let i = sessionStorage.length - 1; i >= 0; i--) { const key = sessionStorage.key(i); if (key?.startsWith("wasl.attempt:")) sessionStorage.removeItem(key); } } catch { /* UI caches are optional. */ } setSuccess("imported"); } return result; },
  };
}
type Value = ReturnType<typeof useWorkspaceState>;
const WorkspaceContext = createContext<Value | null>(null);
export function WorkspaceProvider({ children }: { children: ReactNode }) { const value = useWorkspaceState(); return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>; }
export function useWorkspace() { const value = useContext(WorkspaceContext); if (!value) throw new Error("WorkspaceProvider required"); return value; }
