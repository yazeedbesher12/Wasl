import { createContext, useContext } from 'react';
import type { Locale } from '@wasl/shared';
import { useNativeOptional } from './context';
export const Presentation = createContext<{
  locale: Locale;
  busy: boolean;
  t: (key: string) => string;
} | null>(null);
export function usePresentation() {
  const live = useContext(Presentation);
  const demo = useNativeOptional();
  const value = live ?? demo;
  if (!value) throw new Error('Presentation provider required');
  return value;
}
