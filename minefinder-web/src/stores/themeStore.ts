/**
 * Theme Store
 * 
 * Manages application theme state (light/dark mode) with persistence.
 * Uses Zustand for state management and localStorage for persistence.
 */

import { create } from 'zustand';

type Theme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

// Check for saved theme preference or default to system preference
const getInitialTheme = (): Theme => {
  const saved = localStorage.getItem('mf.theme');
  if (saved === 'light' || saved === 'dark') {
    return saved;
  }
  // Default to system preference
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
};

export const useThemeStore = create<ThemeState>((set) => ({
  theme: getInitialTheme(),
  
  toggleTheme: () => set((state) => {
    const newTheme = state.theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('mf.theme', newTheme);
    return { theme: newTheme };
  }),
  
  setTheme: (theme: Theme) => {
    localStorage.setItem('mf.theme', theme);
    set({ theme });
  },
}));
