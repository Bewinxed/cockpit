<script lang="ts">
  import { IconSun, IconMoon } from '$lib/icons';
  import { theme, toggleTheme } from '$lib/theme.svelte';
  import { Button } from '$lib/components/ui/button';

  const themeLabels = {
    light: 'Light mode',
    dark: 'Dark mode',
    system: 'System',
  };

  const isDark = $derived(theme.current === 'dark');
  const label = $derived(themeLabels[theme.current] || 'Light mode');
</script>

<Button
  variant="ghost"
  size="icon-sm"
  onclick={toggleTheme}
  title={label}
  aria-label={label}
>
  <span class="icon-swap size-4">
    <span data-active={isDark}><IconMoon class="size-4" /></span>
    <span data-active={!isDark}><IconSun class="size-4" /></span>
  </span>
</Button>
