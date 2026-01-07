<script lang="ts">
  import { theme, toggleTheme } from '$lib/stores/theme';
  import { Sun, Moon } from 'lucide-svelte';

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

  const Icon = $derived(themeIcons[$theme] || Sun);
  const label = $derived(themeLabels[$theme] || 'Light mode');
</script>

<button
  onclick={toggleTheme}
  class="p-2 rounded-md text-text-secondary hover:bg-surface-hover hover:text-text transition-all duration-100"
  title={label}
>
  <Icon class="w-4 h-4" />
</button>
