/**
 * Auto-scroll hook for flex-col-reverse containers.
 * With flex-col-reverse, scrollTop=0 means we're at the bottom (newest content).
 * Scrolling up to see older content increases scrollTop.
 */
export class UseAutoScroll {
	#ref = $state<HTMLElement>();
	#scrollTop = $state(0);
	#userHasScrolled = $state(false);
	#isProgrammaticScroll = false;
	private scrollTimeout: ReturnType<typeof setTimeout> | null = null;
	private programmaticScrollTimeout: ReturnType<typeof setTimeout> | null = null;

	set ref(ref: HTMLElement | undefined) {
		this.#ref = ref;
		if (!this.#ref) return;

		// With flex-col-reverse, we're already at bottom (scrollTop=0) on load!
		// Just sync our state
		this.#scrollTop = this.#ref.scrollTop;

		this.#ref.addEventListener('scroll', () => {
			if (!this.#ref) return;
			this.#scrollTop = this.#ref.scrollTop;

			// Don't update userHasScrolled during programmatic scrolls
			if (!this.#isProgrammaticScroll) {
				this.#updateUserScrollState();
			}
		});

		// Auto-scroll on new content
		const observer = new MutationObserver((mutations) => {
			if (!this.#ref) return;

			const hasNewContent = mutations.some(
				(m) => m.type === 'childList' && m.addedNodes.length > 0
			);

			if (hasNewContent) {
				if (this.scrollTimeout) clearTimeout(this.scrollTimeout);
				this.scrollTimeout = setTimeout(() => {
					this.scrollToBottom(true);
				}, 50);
			}
		});

		observer.observe(this.#ref, { childList: true, subtree: true });
	}

	get ref() {
		return this.#ref;
	}

	/** With flex-col-reverse, scrollTop=0 means at bottom */
	get isAtBottom() {
		if (!this.#ref) return true;
		if (this.#isProgrammaticScroll) return true;

		// With flex-col-reverse, scrollTop near 0 means at bottom
		const threshold = 10;
		return this.#scrollTop <= threshold;
	}

	#updateUserScrollState() {
		if (this.isAtBottom) {
			this.#userHasScrolled = false;
		} else {
			this.#userHasScrolled = true;
		}
	}

	/** Scrolls to bottom (scrollTop=0 with flex-col-reverse) */
	scrollToBottom(auto = false) {
		if (!this.#ref) return;
		if (auto && this.#userHasScrolled) return;

		if (!auto) {
			this.#userHasScrolled = false;
		}

		this.#isProgrammaticScroll = true;
		if (this.programmaticScrollTimeout) {
			clearTimeout(this.programmaticScrollTimeout);
		}

		// With flex-col-reverse, scrolling to bottom means scrollTop=0
		this.#ref.scrollTo({ top: 0, behavior: 'smooth' });

		this.programmaticScrollTimeout = setTimeout(() => {
			this.#isProgrammaticScroll = false;
		}, 400);
	}
}
