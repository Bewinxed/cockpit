/**
 * Auto-scroll hook for chat containers.
 * Keeps chat scrolled to bottom unless user scrolls up.
 *
 * Usage in Svelte 5:
 * ```svelte
 * <script>
 *   const scroll = createAutoScroll();
 *
 *   // Trigger scroll when content changes
 *   $effect(() => {
 *     messages.length; // dependency
 *     scroll.scrollToBottom();
 *   });
 * </script>
 *
 * <div bind:this={scroll.ref} onscroll={scroll.onScroll}>
 *   {#each messages as msg}...{/each}
 * </div>
 * ```
 */

export function createAutoScroll() {
	let ref = $state<HTMLElement | undefined>(undefined);
	let userHasScrolled = $state(false);

	function isAtBottom(): boolean {
		if (!ref) return true;
		const threshold = 50;
		return ref.scrollTop + ref.clientHeight >= ref.scrollHeight - threshold;
	}

	function onScroll() {
		userHasScrolled = !isAtBottom();
	}

	function scrollToBottom(force = false) {
		if (!ref) return;
		if (!force && userHasScrolled) return;

		// Use requestAnimationFrame to ensure DOM has updated
		requestAnimationFrame(() => {
			if (!ref) return;
			ref.scrollTo({ top: ref.scrollHeight, behavior: 'smooth' });
			userHasScrolled = false;
		});
	}

	return {
		get ref() { return ref; },
		set ref(el: HTMLElement | undefined) {
			ref = el;
			// Start at bottom
			if (ref) {
				ref.scrollTop = ref.scrollHeight;
			}
		},
		onScroll,
		scrollToBottom,
		get userHasScrolled() { return userHasScrolled; },
		get isAtBottom() { return isAtBottom(); },
	};
}
