import { writable } from 'svelte/store';
import { browser } from '$app/environment';

type Theme = 'light' | 'dark' | 'system';

// Get initial theme from localStorage or default to 'light'
const getInitialTheme = (): Theme => {
  if (!browser) return 'light';
  const stored = localStorage.getItem('cockpit-theme') as Theme | null;
  return stored || 'light';
};

function applyTheme(themeValue: Theme) {
  if (!browser) return;

  const root = document.documentElement;

  if (themeValue === 'system') {
    // Use system preference
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

// Create the theme store with custom logic
function createThemeStore() {
  const { subscribe, set, update } = writable<Theme>(getInitialTheme());

  // Apply initial theme
  if (browser) {
    applyTheme(getInitialTheme());
  }

  return {
    subscribe,
    set: (value: Theme) => {
      if (browser) {
        localStorage.setItem('cockpit-theme', value);
        applyTheme(value);
      }
      set(value);
    },
    update: (fn: (current: Theme) => Theme) => {
      update((current) => {
        const newValue = fn(current);
        if (browser) {
          localStorage.setItem('cockpit-theme', newValue);
          applyTheme(newValue);
        }
        return newValue;
      });
    }
  };
}

export const theme = createThemeStore();

// Listen for system theme changes when theme is set to 'system'
if (browser) {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', () => {
    // Re-read from localStorage to check current theme
    const currentTheme = localStorage.getItem('cockpit-theme') as Theme | null;
    if (currentTheme === 'system') {
      applyTheme('system');
    }
  });
}

export function toggleTheme() {
  theme.update((current) => {
    return current === 'light' ? 'dark' : 'light';
  });
}
