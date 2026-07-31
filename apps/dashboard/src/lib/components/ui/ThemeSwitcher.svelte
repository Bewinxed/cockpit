<script lang="ts">
  import { theme, toggleTheme } from '$lib/theme.svelte';
  import { Sun, Moon } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';

  const themeIcons = {
    light: Sun,
    dark: Moon,
    system: Sun, // Use Sun as fallback for system
  };

  const themeLabels = {
    light: 'Light mode',
    dark: 'Dark mode',
    system: 'System',
  };

  const Icon = $derived(themeIcons[theme.current] || Sun);
  const label = $derived(themeLabels[theme.current] || 'Light mode');
</script>

<Button
  variant="ghost"
  size="icon-sm"
  onclick={toggleTheme}
  title={label}
  aria-label={label}
>
  <Icon class="size-4" />
</Button>
