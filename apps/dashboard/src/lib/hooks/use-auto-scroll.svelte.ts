/** Use this on a vertically scrollable container to ensure that it automatically scrolls to the bottom of the content.
 *
 * ## Usage
 * ```svelte
 * <script lang="ts">
 *      import { UseAutoScroll } from '$lib/hooks/use-auto-scroll.svelte';
 *
 *      let { children } = $props();
 *
 *      const autoScroll = new UseAutoScroll();
 * </script>
 *
 * <div>
 *      <div bind:this={autoScroll.ref}>
 *          {@render children?.()}
 *      </div>
 *      {#if !autoScroll.isAtBottom}
 *          <button onclick={() => autoScroll.scrollToBottom()}>
 *              Scroll To Bottom
 *          </button>
 *      {/if}
 * </div>
 * ```
 */
export class UseAutoScroll {
	#ref = $state<HTMLElement>();
	#scrollY: number = $state(0);
	#userHasScrolled = $state(false);
	private lastScrollHeight = 0;
	private lastChildCount = 0;
	private scrollTimeout: ReturnType<typeof setTimeout> | null = null;

	// This sets everything up once #ref is bound
	set ref(ref: HTMLElement | undefined) {
		this.#ref = ref;

		if (!this.#ref) return;

		this.lastScrollHeight = this.#ref.scrollHeight;
		this.lastChildCount = this.#ref.children.length;

		// start from bottom or start position
		this.#ref.scrollTo(0, this.#scrollY ? this.#scrollY : this.#ref.scrollHeight);

		this.#ref.addEventListener('scroll', () => {
			if (!this.#ref) return;

			this.#scrollY = this.#ref.scrollTop;

			this.disableAutoScroll();
		});

		window.addEventListener('resize', () => {
			this.scrollToBottom(true);
		});

		// Detect when new content is added (not just height changes from expandables)
		const observer = new MutationObserver((mutations) => {
			if (!this.#ref) return;

			// Only auto-scroll if new direct children were added (new messages)
			// Don't scroll for attribute changes or subtree changes (like collapsible expansion)
			const hasNewChildren = this.#ref.children.length > this.lastChildCount;

			// Also check if a childList mutation happened at the top level
			const hasTopLevelAddition = mutations.some(
				(m) => m.type === 'childList' && m.addedNodes.length > 0 && m.target === this.#ref
			);

			if (hasNewChildren || hasTopLevelAddition) {
				// Debounce scroll to avoid rapid calls during animations
				if (this.scrollTimeout) clearTimeout(this.scrollTimeout);
				this.scrollTimeout = setTimeout(() => {
					this.scrollToBottom(true);
				}, 50);
			}

			this.lastChildCount = this.#ref.children.length;
			this.lastScrollHeight = this.#ref.scrollHeight;
		});

		observer.observe(this.#ref, { childList: true, subtree: true });
	}

	get ref() {
		return this.#ref;
	}

	get scrollY() {
		return this.#scrollY;
	}

	/** Checks if the container is scrolled to the bottom */
	get isAtBottom() {
		if (!this.#ref) return true;

		return this.#scrollY + this.#ref.offsetHeight >= this.#ref.scrollHeight;
	}

	/** Disables auto scrolling until the container is scrolled back to the bottom */
	disableAutoScroll() {
		if (this.isAtBottom) {
			this.#userHasScrolled = false;
		} else {
			this.#userHasScrolled = true;
		}
	}

	/** Scrolls the container to the bottom */
	scrollToBottom(auto = false) {
		if (!this.#ref) return;

		// don't auto scroll if user has scrolled
		if (auto && this.#userHasScrolled) return;

		this.#ref.scrollTo(0, this.#ref.scrollHeight);
	}
}
