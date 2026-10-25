import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ThemeProvider } from '@wordpress/theme';
import { useEnableWpCompatOverlaySlot } from '@wordpress/ui';

type ThemeChoice = 'system' | 'light' | 'dark';
const ThemeContext = createContext<{ choice: ThemeChoice; setChoice: (choice: ThemeChoice) => void }>({ choice: 'system', setChoice: () => {} });
export function useThemeChoice() { return useContext(ThemeContext); }

export function AppTheme({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<ThemeChoice>('system');
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEnableWpCompatOverlaySlot();
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const change = () => setSystemDark(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  const dark = choice === 'dark' || (choice === 'system' && systemDark);
  useEffect(() => { document.documentElement.dataset.feedsTheme = dark ? 'dark' : 'light'; }, [dark]);
  return <ThemeContext.Provider value={{ choice, setChoice }}><ThemeProvider isRoot color={{ primary: '#3858e9', background: dark ? '#1b1d21' : '#fcfcfc' }} cornerRadius="subtle">{children}</ThemeProvider></ThemeContext.Provider>;
}
