/**
 * What a context-menu item does when it copies something. The menu is gone by
 * the time the write lands, so the toast is the only place the result can show.
 */
import { toast } from 'svelte-sonner';

export async function copyToClipboard(what: string, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    // Denied permission, or no clipboard at all over plain http on a LAN address.
    toast.error(`Could not copy the ${what.toLowerCase()}.`);
  }
}
