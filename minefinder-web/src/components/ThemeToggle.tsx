/**
 * Theme Toggle Button
 */
import { useThemeStore } from '../stores/themeStore';

export function ThemeToggle() {
  const { theme, toggleTheme } = useThemeStore();

  return (
    <button onClick={toggleTheme} className="theme-toggle" title="Toggle theme">
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );
}
