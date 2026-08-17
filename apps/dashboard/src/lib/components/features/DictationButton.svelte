<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { IconMic } from '$lib/icons';

  interface Props {
    disabled?: boolean;
    /** A phrase the recogniser has settled on, ready to go into the message. */
    onfinal: (text: string) => void;
    /** What it has heard but not settled — shown, never committed. */
    oninterim: (text: string) => void;
  }

  let { disabled = false, onfinal, oninterim }: Props = $props();

  /* lib.dom carries the result types but neither the recogniser nor its events,
     and the engines that ship it still answer to the prefixed name. */
  interface RecognitionEvent {
    resultIndex: number;
    results: SpeechRecognitionResultList;
  }

  interface RecognitionErrorEvent {
    error: string;
    message: string;
  }

  interface Recognizer {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: ((event: RecognitionEvent) => void) | null;
    onerror: ((event: RecognitionErrorEvent) => void) | null;
    onend: (() => void) | null;
    start(): void;
    stop(): void;
  }

  type RecognizerCtor = new () => Recognizer;

  type SpeechCapableWindow = Window & {
    SpeechRecognition?: RecognizerCtor;
    webkitSpeechRecognition?: RecognizerCtor;
  };

  let Recognition = $state<RecognizerCtor | null>(null);
  let listening = $state(false);
  /** The last refusal, carried on the control rather than thrown at the reader. */
  let fault = $state('');

  // Looked up after mount, so the first client paint agrees with the server's,
  // which rendered nothing: a browser that cannot hear gets no control at all.
  $effect(() => {
    const scope = window as SpeechCapableWindow;
    Recognition = scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
  });

  // The recogniser lives exactly as long as the listening does: one is built
  // when the button goes on, and torn down — handlers first, so its own `end`
  // cannot turn the button back on — when it goes off or the dock unmounts.
  $effect(() => {
    if (!listening || !Recognition) return;

    const live = new Recognition();
    live.continuous = true;
    live.interimResults = true;
    live.lang = navigator.language;

    live.onresult = (event) => {
      let settled = '';
      let pending = '';
      // Everything before `resultIndex` has already been handed over.
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const spoken = result[0]?.transcript ?? '';
        if (result.isFinal) settled += spoken;
        else pending += spoken;
      }
      if (settled.trim()) onfinal(settled.trim());
      oninterim(pending.trim());
    };

    live.onerror = (event) => {
      // Far more often the reader's own microphone permission than a fault, so
      // it names itself on the button and nowhere else.
      fault =
        event.error === 'not-allowed'
          ? 'Microphone blocked'
          : `Dictation stopped: ${event.error}`;
      console.debug('dictation error', event.error, event.message);
      listening = false;
    };

    live.onend = () => {
      listening = false;
    };

    live.start();

    return () => {
      live.onresult = null;
      live.onerror = null;
      live.onend = null;
      live.stop();
      oninterim('');
    };
  });

  function toggle() {
    fault = '';
    listening = !listening;
  }

  /** The dock takes the microphone off when the message goes, and when the
   *  reader's attention leaves it. */
  export function stop() {
    listening = false;
  }
</script>

{#if Recognition}
  <Button
    variant="ghost"
    size="icon-sm"
    class={listening ? 'text-primary' : 'text-muted-foreground'}
    {disabled}
    aria-pressed={listening}
    aria-label={listening ? 'Stop dictation' : 'Dictate message'}
    title={fault || (listening ? 'Stop dictation' : 'Dictate message')}
    onclick={toggle}
  >
    <IconMic class={listening ? 'animate-pulse motion-reduce:animate-none' : ''} />
  </Button>
{/if}
