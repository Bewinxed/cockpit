import { browser } from '$app/environment';

type Theme = 'light' | 'dark' | 'system';

function getInitialTheme(): Theme {
  if (!browser) return 'light';
  const stored = localStorage.getItem('whiffle-theme') as Theme | null;
  return stored || 'light';
}

function applyTheme(themeValue: Theme) {
  if (!browser) return;

  const root = document.documentElement;

  if (themeValue === 'system') {
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (systemPrefersDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  } else if (themeValue === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

class ThemeState {
  current = $state<Theme>(getInitialTheme());

  constructor() {
    if (browser) {
      applyTheme(this.current);

      // Listen for system theme changes
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.addEventListener('change', () => {
        if (this.current === 'system') {
          applyTheme('system');
        }
      });
    }
  }

  set(value: Theme) {
    this.current = value;
    if (browser) {
      localStorage.setItem('whiffle-theme', value);
      applyTheme(value);
    }
  }

  toggle() {
    this.set(this.current === 'light' ? 'dark' : 'light');
  }
}

export const theme = new ThemeState();

export function toggleTheme() {
  theme.toggle();
}
