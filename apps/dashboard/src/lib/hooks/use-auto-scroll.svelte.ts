/**
 * Auto-scroll hook for chat containers.
 * Supports both standard and flex-col-reverse scroll directions.
 *
 * With flex-col-reverse, scrollTop=0 is the visual bottom (newest content),
 * and scrolling up gives negative scrollTop values.
 */

export function createAutoScroll() {
  let ref = $state<HTMLElement | undefined>(undefined);
  let userHasScrolled = $state(false);
  let reversed = false;

  function isAtBottom(): boolean {
    if (!ref) {
      return true;
    }
    const threshold = 50;
    if (reversed) {
      // flex-col-reverse: scrollTop=0 at visual bottom, negative when scrolled up
      return Math.abs(ref.scrollTop) < threshold;
    }
    return ref.scrollTop + ref.clientHeight >= ref.scrollHeight - threshold;
  }

  function onScroll() {
    userHasScrolled = !isAtBottom();
  }

  function scrollToBottom(force = false) {
    if (!ref) {
      return;
    }
    if (!force && userHasScrolled) {
      return;
    }

    requestAnimationFrame(() => {
      if (!ref) {
        return;
      }
      ref.scrollTo({
        top: reversed ? 0 : ref.scrollHeight,
        behavior: "smooth",
      });
      userHasScrolled = false;
    });
  }

  return {
    get ref() {
      return ref;
    },
    set ref(el: HTMLElement | undefined) {
      ref = el;
      if (ref) {
        reversed = getComputedStyle(ref).flexDirection === "column-reverse";
        if (!reversed) {
          ref.scrollTop = ref.scrollHeight;
        }
        // flex-col-reverse already starts at scrollTop=0 (visual bottom)
      }
    },
    onScroll,
    scrollToBottom,
    get userHasScrolled() {
      return userHasScrolled;
    },
    get isAtBottom() {
      return isAtBottom();
    },
  };
}
