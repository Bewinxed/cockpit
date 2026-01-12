/**
 * Auto-scroll hook for chat containers.
 * Keeps chat scrolled to bottom (newest content) unless user scrolls up.
 */
export class UseAutoScroll {
	#ref = $state<HTMLElement>();
	#userHasScrolled = $state(false);
	#isProgrammaticScroll = false;
	private scrollTimeout: ReturnType<typeof setTimeout> | null = null;
	private programmaticScrollTimeout: ReturnType<typeof setTimeout> | null = null;

	set ref(ref: HTMLElement | undefined) {
		this.#ref = ref;
		if (!this.#ref) return;

		// Start scrolled to bottom
		this.#ref.scrollTop = this.#ref.scrollHeight;

		this.#ref.addEventListener('scroll', () => {
			if (!this.#ref) return;

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

	/** Check if we're at the bottom of the scroll container */
	get isAtBottom() {
		if (!this.#ref) return true;
		if (this.#isProgrammaticScroll) return true;

		// At bottom when scrollTop + clientHeight >= scrollHeight (with threshold)
		const threshold = 50;
		const { scrollTop, scrollHeight, clientHeight } = this.#ref;
		return scrollTop + clientHeight >= scrollHeight - threshold;
	}

	#updateUserScrollState() {
		if (this.isAtBottom) {
			this.#userHasScrolled = false;
		} else {
			this.#userHasScrolled = true;
		}
	}

	/** Scrolls to bottom (newest content) */
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

		// Scroll to bottom (scrollHeight)
		this.#ref.scrollTo({ top: this.#ref.scrollHeight, behavior: 'smooth' });

		this.programmaticScrollTimeout = setTimeout(() => {
			this.#isProgrammaticScroll = false;
		}, 400);
	}
}
