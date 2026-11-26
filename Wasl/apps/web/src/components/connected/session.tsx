'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { WaslClient, type Locale, type MeDto, type Role } from '@wasl/shared';
import { text } from '@wasl/shared/demo';

export const client = new WaslClient('/api/wasl');
export const home = (role?: string) =>
  role === 'PLATFORM_ADMIN'
    ? '/admin'
    : role === 'SCHOOL_ADMIN'
      ? '/school/dashboard'
      : role === 'TEACHER'
        ? '/teacher/dashboard'
        : role === 'STUDENT'
          ? '/student/dashboard'
          : '/parent/children';
function useSessionState() {
  const [user, setUser] = useState<MeDto | null>(null);
  const [ready, setReady] = useState(false);
  const [locale, setLanguage] = useState<Locale>('ar');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const generation = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);
  const broadcast = () => channel.current?.postMessage('session-changed');
  const t = (key: string) => text(locale, key);
  const refresh = useCallback(async () => {
    const current = generation.current;
    try {
      const me = await client.me();
      if (current === generation.current) {
        setUser(me);
        setError('');
      }
      return me;
    } catch (e) {
      if (current === generation.current) {
        if ((e as { status?: number }).status === 401) setUser(null);
        else setError('serviceUnavailable');
      }
      return null;
    } finally {
      if (current === generation.current) setReady(true);
    }
  }, []);
  useEffect(() => {
    try {
      setLanguage(localStorage.getItem('wasl.locale') === 'en' ? 'en' : 'ar');
    } catch {}
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const c = new BroadcastChannel('wasl-session');
    channel.current = c;
    c.onmessage = () => {
      generation.current++;
      setUser(null);
      setReady(false);
      void refresh();
    };
    return () => {
      channel.current = null;
      c.close();
    };
  }, [refresh]);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);
  const setLocale = (next: Locale) => {
    setLanguage(next);
    try {
      localStorage.setItem('wasl.locale', next);
    } catch {}
  };
  const login = async (email: string, password: string) => {
    if (busy) return;
    generation.current++;
    setBusy(true);
    setError('');
    try {
      await client.login(email, password);
      const me = await client.me();
      setUser(me);
      broadcast();
      router.replace(home(me.activeRole));
    } catch (e) {
      setError(
        (e as { status?: number }).status === 401 ? 'invalidCredentials' : 'serviceUnavailable',
      );
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    if (busy) return;
    const retry = error === 'revocationUnconfirmed';
    const current = ++generation.current;
    setBusy(true);
    setError('');
    setUser(null);
    try {
      const r = await fetch('/api/wasl/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!r.ok || (retry && (await r.json()).revocation === 'not-requested'))
        throw new Error('Revocation unconfirmed');
    } catch {
      if (current === generation.current) setError('revocationUnconfirmed');
    } finally {
      if (current === generation.current) {
        broadcast();
        router.replace('/login');
      }
      setBusy(false);
    }
  };
  const switchContext = async (schoolId: string | null, role: Role, destination?: string) => {
    if (busy) return;
    generation.current++;
    setBusy(true);
    setError('');
    try {
      await client.switchSchool(schoolId, role);
      const me = await client.me();
      setUser(me);
      broadcast();
      router.replace(destination ?? home(me.activeRole));
    } catch {
      setError('unavailable');
    } finally {
      setBusy(false);
    }
  };
  return {
    user,
    ready,
    refresh,
    locale,
    setLocale,
    t,
    login,
    logout,
    switchContext,
    busy,
    error,
    setError,
    generation,
  };
}
const Context = createContext<ReturnType<typeof useSessionState> | null>(null);
export function ApiSessionProvider({ children }: { children: ReactNode }) {
  const value = useSessionState();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useApiSession() {
  const value = useContext(Context);
  if (!value) throw new Error('ApiSessionProvider required');
  return value;
}
