<script lang="ts">
  /**
   * The one control that opens the context rail, on a phone and on a desktop
   * alike. It exists as its own component because the kit's sidebar state is a
   * context: the page *sets* it by rendering the provider, so only a child can
   * read it — and `Sidebar.Trigger` hard-codes its own icon, which is the left
   * rail's, not this one's.
   */
  import { IconDocument } from '$lib/icons';
  import { Button } from '$lib/components/ui/button';
  import { useSidebar } from '$lib/components/ui/sidebar';

  const sidebar = useSidebar();

  /** Two open flags, one for each mode; `toggle` already picks the right one. */
  const open = $derived(sidebar.isMobile ? sidebar.openMobile : sidebar.open);
</script>

<Button
  variant={open ? 'secondary' : 'outline'}
  size="icon-sm"
  class="shrink-0"
  aria-pressed={open}
  aria-label="Session context"
  title="The CLAUDE.md files, MCP servers and facts of this session"
  onclick={sidebar.toggle}
>
  <IconDocument />
</Button>
