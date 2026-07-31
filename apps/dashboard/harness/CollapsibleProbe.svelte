<script lang="ts">
  import * as Collapsible from '$lib/components/ui/collapsible';

  let { open }: { open: boolean } = $props();
</script>

<Collapsible.Root {open}>
  <Collapsible.Trigger>toggle</Collapsible.Trigger>
  <Collapsible.Content>
    <p>SECRET_CHILD_PAYLOAD</p>
  </Collapsible.Content>
</Collapsible.Root>
