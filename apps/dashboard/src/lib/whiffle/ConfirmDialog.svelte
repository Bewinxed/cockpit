<script lang="ts">
  /**
   * The single host for {@link confirm}. Mounted once in the shell; renders
   * whatever the current `confirm(...)` call asked for, and answers it. Every
   * destructive action in the app funnels through this one dialog.
   */
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { confirmHost } from './confirm.svelte';

  const pending = $derived(confirmHost.pending);
</script>

<AlertDialog.Root
  open={pending !== null}
  onOpenChange={(next) => {
    if (!next) confirmHost.answer(false);
  }}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{pending?.title}</AlertDialog.Title>
      {#if pending?.body}
        <AlertDialog.Description>{pending.body}</AlertDialog.Description>
      {/if}
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{pending?.cancelLabel ?? 'Cancel'}</AlertDialog.Cancel>
      <AlertDialog.Action
        variant={pending?.destructive ? 'destructive' : 'default'}
        onclick={() => confirmHost.answer(true)}
      >
        {pending?.confirmLabel ?? 'Confirm'}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
