<script lang="ts">
  /**
   * One delegated session's whole run, folded out of the parent transcript into
   * a branch the reader opens on purpose (NEW.md §1). A delegate is a full fleet
   * instance, so its live text, tools and status are already folded into client
   * state — this only composes them, the same way SubagentBranch composes a
   * subagent branch. Collapsed it says what it is doing; expanded it is the
   * delegate's own transcript.
   */
  import { IconChevronRight, IconSuccess, IconError, IconSpinner, IconSubagentsDuo } from '$lib/icons';
  import * as Collapsible from '$lib/components/ui/collapsible';
  import { Markdown } from '$lib/components/ui/markdown';
  import { modelLabel, providerOf } from '$lib/cockpit/models.svelte';
  import { askDetail, askDetailOf, askShort, askShortOf, matchesSession } from '$lib/cockpit/frames';
  import {
    backfillSession,
    cockpit,
    unwatchDelegate,
    watchDelegate,
  } from '$lib/cockpit/client.svelte';
  import ProviderLogo from './ProviderLogo.svelte';
  import type {
    DelegateAskEvent,
    DelegateAskStatus,
    DelegateReportEvent,
    Message,
  } from '$lib/cockpit/types';
  import type { MessageRendererProps } from './message-renderers';
  import ChatMessage from './ChatMessage.svelte';
  import { standsAlone } from './message-renderers';
  import ToolGroup from './ToolGroup.svelte';
  import OutputBlock from './tool-cards/OutputBlock.svelte';
  import ReportBody from './tool-cards/ReportBody.svelte';
  let { message }: MessageRendererProps = $props();

  const leaf = (path: string): string => path.split('/').filter(Boolean).pop() ?? path;

  /** The delegate instance id, set by {@link applyToolResult} when the result arrives. */
  const id = $derived(message.metadata?.delegateInstanceId ?? null);

  const row = $derived.by(() =>
    id ? cockpit.instances.find((r) => r.id === id) : undefined
  );
  const delegateState = $derived.by(() => (id ? cockpit.session(id) : undefined));

  /** The hub's own record of this delegate's traffic with the parent. */
  const events = $derived(id ? cockpit.delegateEventsOf(id) : []);
  const askEvents = $derived(
    events.filter((event): event is DelegateAskEvent => event.kind === 'ask')
  );
  const reportEvents = $derived(
    events.filter((event): event is DelegateReportEvent => event.kind === 'report')
  );

  const live = $derived(row?.status === 'running' || row?.status === 'starting');
  const busy = $derived(Boolean(delegateState?.busy || delegateState?.streaming));
  const failed = $derived(row?.status === 'error' || (!id && message.metadata?.toolStatus === 'error'));

  // Delivered once the delegate has reported a turn. The hub records every
  // report; only a delegate that ran before it did needs the parent transcript
  // read for one — a peer message whose origin names the delegate as sender.
  const delivered = $derived.by(() => {
    if (!id) return false;
    if (reportEvents.length > 0) return true;
    const parent = cockpit.session(message.instanceId);
    return (parent?.messages ?? []).some(
      (m) => m.type === 'user.peer' && matchesSession(m.metadata?.peerSession, id)
    );
  });

  /** The tool call was made but the result has not arrived yet — no instance id. */
  const spawning = $derived(!id && !failed);

  const status = $derived<'spawning' | 'working' | 'failed' | 'delivered' | 'idle'>(
    spawning ? 'spawning' : failed ? 'failed' : live && busy ? 'working' : delivered ? 'delivered' : 'idle'
  );
  /** Actively in flight — spawning or the delegate is working. */
  const working = $derived(status === 'working' || status === 'spawning');

  const label = $derived(row ? leaf(row.cwd) : message.content ? leaf(message.content) : 'delegate');

  /** The tool input carries `harness` and `model` before the result arrives. */
  const toolInput = $derived.by((): Record<string, unknown> | null => {
    const raw = message.metadata?.toolInput;
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  });
  const harness = $derived(row?.harness ?? delegateState?.harness ?? String(toolInput?.harness ?? ''));
  const model = $derived(delegateState?.model ?? row?.model ?? String(toolInput?.model ?? ''));

  let open = $state(false);

  /**
   * Expanding the card is the only sign this delegate's transcript is wanted,
   * since its parent's transcript is what the reader is in. Watching the
   * instance subscribes its frames, and a backfill reads the transcript already
   * stored — the two together cover a live delegate and one that already ran.
   */
  const onToggle = (nextOpen: boolean) => {
    open = nextOpen;
    if (!id) return;
    if (nextOpen) {
      watchDelegate(id);
      void backfillSession(id);
    } else {
      unwatchDelegate(id);
    }
  };

  const isTool = (m: Message) =>
    (m.type === 'tool.use' || m.type === 'tool.result') && !standsAlone(m);

  // The delegate's own transcript, grouped the way the main thread groups it.
  const groups = $derived.by(() => {
    const messages = delegateState?.messages ?? [];
    const result: Array<
      { kind: 'single'; message: Message } | { kind: 'tools'; messages: Message[]; at: number }
    > = [];
    let i = 0;
    while (i < messages.length) {
      if (!isTool(messages[i])) {
        result.push({ kind: 'single', message: messages[i] });
        i++;
        continue;
      }
      const at = i;
      const tools: Message[] = [];
      while (i < messages.length && isTool(messages[i])) {
        tools.push(messages[i]);
        i++;
      }
      result.push({ kind: 'tools', messages: tools, at });
    }
    return result;
  });

  const hasMessages = $derived((delegateState?.messages.length ?? 0) > 0);
  const streaming = $derived(delegateState?.streaming ?? '');

  /** What the sender asked it to do, so the resolved card says so too. */
  const brief = $derived(message.metadata?.handoffBrief ?? '');

  /**
   * The cumulative cost the delegate's own result frames have reported, in
   * dollars — kept on the session state, since a successful turn has no
   * transcript line to scrape it from.
   */
  const totalCost = $derived(delegateState?.totalCost ?? 0);

  /**
   * The newest turn the delegate reported, how many it has reported, and
   * whether that turn failed — off the hub's rows where there are any, and off
   * the parent transcript's `[Report from delegate …]` markers where the
   * delegate predates the `delegate_events` table.
   */
  const report = $derived.by((): { body: string; failed: boolean; count: number } | null => {
    if (reportEvents.length > 0) {
      const { payload } = reportEvents[reportEvents.length - 1];
      return { body: payload.body, failed: payload.failed, count: reportEvents.length };
    }
    if (!id) return null;
    const parent = cockpit.session(message.instanceId);
    const peers = (parent?.messages ?? []).filter(
      (m) => m.type === 'user.peer' && matchesSession(m.metadata?.peerSession, id)
    );
    const latest = peers[peers.length - 1];
    if (!latest) return null;
    return {
      body: latest.content,
      failed: latest.metadata?.reportKind === 'failed',
      count: peers.length,
    };
  });

  /** The report's first non-empty line — the collapsed card's outcome glimpse. */
  const glimpse = $derived.by(() => {
    if (!report) return '';
    return (
      report.body
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? ''
    );
  });

  /**
   * The delegate's permission asks routed to this parent, oldest first, each
   * with its answered/denied/pending state. The hub's rows carry the state
   * themselves; a delegate whose asks predate them is read back out of the
   * parent transcript instead — an ask is answered there when the parent's
   * `answer_delegate` call names its requestId, `deny: true` reads as denied,
   * and a missing requestId stays pending rather than crashing the match.
   */
  const asks = $derived.by(
    (): Array<{ key: string; status: DelegateAskStatus; short: string; detail: string }> => {
      if (!id) return [];
      if (askEvents.length > 0) {
        return askEvents.map((ask) => ({
          key: String(ask.id),
          status: ask.status ?? 'pending',
          short: askShortOf(ask.toolName, ask.payload.input ?? {}),
          detail: askDetailOf(ask.toolName, ask.payload.input ?? {}),
        }));
      }
      const parentMessages = cockpit.session(message.instanceId)?.messages ?? [];
      const stored = parentMessages.filter(
        (m) => m.type === 'user.delegate_ask' && m.metadata?.peerSession === id
      );
      return stored.map((ask, index) => {
        const requestId = ask.metadata?.askRequestId;
        let status: DelegateAskStatus = 'pending';
        if (requestId) {
          const answer = parentMessages.find(
            (m) =>
              m.type === 'tool.use' &&
              (m.metadata?.toolName ?? '').includes('answer_delegate') &&
              JSON.stringify(m.metadata?.toolInput ?? null).includes(requestId)
          );
          if (answer) {
            const input = answer.metadata?.toolInput;
            const denied =
              typeof input === 'object' && input !== null && !Array.isArray(input) && input.deny === true;
            status = denied ? 'denied' : 'answered';
          }
        }
        return {
          key: ask.id ?? `ask-${index}`,
          status,
          short: askShort(ask.content),
          detail: askDetail(ask.content),
        };
      });
    }
  );

  /** The expanded transcript's scroller, bound below. */
  let transcriptEl = $state<HTMLDivElement | null>(null);
  /** Whether the reader is already at the tail — the only state that earns autoscroll. */
  let nearBottom = $state(true);

  const onScroll = () => {
    const el = transcriptEl;
    if (!el) return;
    nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 40;
  };

  // While a working delegate grows its transcript, keep the tail in view — but
  // only for a reader who is already there. Scrolling up unpins; coming back
  // down to the bottom re-pins.
  $effect(() => {
    void delegateState?.messages.length;
    void delegateState?.streaming;
    if (!working || !nearBottom) return;
    const el = transcriptEl;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  });
</script>

  <div class="w-full overflow-hidden rounded-xl bg-card shadow-sm motion-reduce:transition-none">
    <Collapsible.Root {open} onOpenChange={onToggle}>
      <Collapsible.Trigger class="group/delegate w-full text-left">
        <div class="flex cursor-pointer items-start gap-2 px-4 py-3 transition-colors hover:bg-muted/30">
          <span class="relative size-6 shrink-0">
            <div
              class="flex size-6 shrink-0 items-center justify-center rounded-md transition-opacity duration-150 md:group-hover/delegate:opacity-0 md:group-focus-within/delegate:opacity-0
                {status === 'failed' ? 'bg-destructive/10 text-destructive' : working ? 'bg-primary/10 text-primary' : 'bg-success/10'}"
            >
              {#if providerOf(model)}
                <!-- Sized to the glyph it stands in for, not left on the 16px
                     default: the two swap into the same 24px well, and a mark
                     that arrives 2px larger than the icon it replaces eats the
                     well's padding and reads as though it is bursting out. -->
                <ProviderLogo model={model} size={14} />
              {:else}
                <IconSubagentsDuo
                  class="size-3.5 {status === 'failed'
                    ? 'text-destructive'
                    : working
                      ? 'text-primary'
                      : 'text-success'}"
                />
              {/if}
            </div>
            <IconChevronRight
              class="absolute inset-0 m-auto size-4 text-muted-foreground opacity-0 transition-all duration-240 ease-expo md:group-hover/delegate:opacity-100 md:group-focus-within/delegate:opacity-100 {open
                ? 'rotate-90'
                : ''}"
            />
          </span>

          <div class="min-w-0 flex-1">
            <div class="flex items-baseline gap-2">
              {#if id}
                <a
                  href="/session/{id}"
                  class="text-caption font-medium text-foreground underline-offset-2 hover:text-primary hover:underline"
                  onclick={(event) => event.stopPropagation()}
                >
                  {label}
                </a>
              {:else}
                <span class="text-caption font-medium text-foreground">{label}</span>
              {/if}
              {#if harness}
                <span class="shrink-0 font-mono text-micro text-faint">{harness}</span>
              {/if}
              {#if model}
                <span class="shrink-0 font-mono text-micro text-faint">{modelLabel(model)}</span>
              {/if}
            </div>
            {#if brief}
              <p class="mt-0.5 text-caption text-muted-foreground line-clamp-2">{brief}</p>
            {/if}
            {#if !(report && !open && status === 'delivered')}
              <div class="mt-1 flex items-center gap-1.5">
                <span
                  class="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 text-micro
                    font-medium
                    {status === 'failed'
                      ? 'bg-destructive/15 text-destructive'
                      : working
                        ? 'bg-primary/15 text-primary'
                        : status === 'delivered'
                          ? 'bg-success/15 text-success'
                          : 'bg-muted text-muted-foreground'}"
                >
                  {status}
                </span>
              </div>
            {/if}
          </div>

          <div class="flex shrink-0 items-center gap-1.5">
            {#if totalCost > 0}
              <span class="shrink-0 font-mono text-micro tabular-nums text-faint">
                ${totalCost.toFixed(4)}
              </span>
            {/if}
            {#if hasMessages}
              <span class="rounded-4xl bg-muted px-1.5 py-0.5 font-mono text-micro text-muted-foreground">
                {delegateState?.messages.length}
              </span>
            {/if}
            {#if status === 'failed'}
              <IconError class="size-4 text-destructive" />
            {:else if working}
              <IconSpinner class="size-4 animate-spin text-primary" />
            {:else}
              <IconSuccess class="size-4 text-success" />
            {/if}
          </div>
        </div>

        {#if report && !open}
          <div class="border-t border-border/40 px-4 py-2">
            <p
              class="line-clamp-1 text-micro {report.failed
                ? 'text-destructive/80'
                : 'text-muted-foreground'}"
            >
              {#if report.failed}turn failed · {/if}{glimpse}
            </p>
          </div>
        {/if}
      </Collapsible.Trigger>

      <Collapsible.Content>
        <div
          bind:this={transcriptEl}
          onscroll={onScroll}
          class="max-h-96 space-y-3 overflow-y-auto border-t border-border/50 px-4 py-3 pl-[calc(1rem+22px)]"
          style="background:var(--rail) calc(1rem + 11px) 0.75rem/2px calc(100% - 1.5rem) no-repeat"
        >
          {#each groups as group (group.kind === 'tools' ? `tools-${group.at}` : group.message.id)}
            {#if group.kind === 'tools'}
              <ToolGroup tools={group.messages} />
            {:else}
              <ChatMessage message={group.message} instanceId={id ?? undefined} />
            {/if}
          {/each}

          {#if streaming}
            <div
              class="max-w-[min(65ch,100%)] min-w-0 text-body leading-relaxed text-foreground break-words"
            >
              <Markdown source={streaming} /><span
                class="inline-block w-[3px] h-4 rounded-sm bg-primary/60 align-text-bottom animate-pulse"
              ></span>
            </div>
          {/if}

          {#if !hasMessages && !streaming}
            {#if spawning}
              <p class="text-caption text-muted-foreground">Spawning delegate…</p>
            {:else if delegateState?.loading}
              <p class="text-caption text-muted-foreground">Loading transcript…</p>
            {:else if status === 'working'}
              <p class="text-caption">Waiting for the first message…</p>
            {:else}
              <p class="text-caption text-muted-foreground">No transcript yet.</p>
            {/if}
          {/if}
        </div>

        {#if asks.length > 0}
          <div class="border-t border-border/50 px-4 py-3">
            <div class="flex items-center gap-2">
              <span class="text-micro font-medium text-muted-foreground">Asks</span>
              <span
                class="rounded-4xl bg-muted px-1.5 py-0.5 font-mono text-micro text-muted-foreground"
              >
                {asks.length} asks
              </span>
            </div>
            <div class="mt-1.5 max-h-48 space-y-1 overflow-y-auto">
              {#each asks as ask (ask.key)}
                <Collapsible.Root>
                  <div class="flex items-start gap-2">
                    {#if ask.status === 'answered'}
                      <IconSuccess class="size-3.5 shrink-0 mt-0.5 text-success" />
                    {:else if ask.status === 'denied'}
                      <IconError class="size-3.5 shrink-0 mt-0.5 text-destructive" />
                    {:else}
                      <IconSpinner class="size-3.5 shrink-0 mt-0.5 animate-spin text-primary" />
                    {/if}
                    <div class="min-w-0 flex-1">
                      <Collapsible.Trigger class="w-full text-left">
                        <span
                          class="block w-full cursor-pointer font-mono text-micro text-muted-foreground
                            line-clamp-2 break-all transition-colors hover:text-foreground"
                        >
                          {ask.short}
                        </span>
                      </Collapsible.Trigger>
                      <Collapsible.Content>
                        <div class="mt-1">
                          <OutputBlock text={ask.detail} />
                        </div>
                      </Collapsible.Content>
                    </div>
                  </div>
                </Collapsible.Root>
              {/each}
            </div>
          </div>
        {/if}

        {#if report}
          <div class="border-t border-border/50 px-4 py-3">
            <div class="rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
              <div class="flex items-center gap-2">
                <span class="text-micro font-medium text-muted-foreground">Report</span>
                {#if report.failed}
                  <span
                    class="rounded-4xl bg-destructive/15 px-1.5 py-0.5 text-micro font-medium text-destructive"
                  >
                    turn failed
                  </span>
                {/if}
                {#if report.count > 1}
                  <span
                    class="rounded-4xl bg-muted px-1.5 py-0.5 font-mono text-micro text-muted-foreground"
                  >
                    {report.count} turns reported
                  </span>
                {/if}
              </div>
              <div class="mt-1.5">
                <ReportBody text={report.body} />
              </div>
            </div>
          </div>
        {/if}

        {#if id}
        <div class="border-t border-border/50 px-4 py-2">
          <a
            href="/session/{id}"
            class="inline-flex items-center gap-1.5 text-micro font-medium text-muted-foreground
              underline-offset-2 hover:text-primary hover:underline"
          >
            Open session
          </a>
        </div>
        {/if}
      </Collapsible.Content>
    </Collapsible.Root>
  </div>
