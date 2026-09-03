const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * Whether focus is in something that takes text. A shortcut that is a bare
 * letter has to ask this before it takes the key off whoever is typing.
 */
export function isTyping(): boolean {
  const focused = document.activeElement;
  return (
    focused instanceof HTMLElement &&
    (TYPING.has(focused.tagName) || focused.isContentEditable)
  );
}
