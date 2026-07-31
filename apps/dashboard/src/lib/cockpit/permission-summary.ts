/**
 * One line naming what a parked tool call would do. The permission card and the
 * fleet view's "needs attention" rail have to read identically — the rail is how
 * you decide which session to open, the card is what you approve there.
 */
export function permissionSummary(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Edit':
    case 'Write':
    case 'Read':
      return `${toolName} ${input.file_path ?? 'unknown'}`;
    case 'Bash':
      return `Run: ${String(input.command ?? '').slice(0, 80)}`;
    case 'Glob':
    case 'Grep':
      return `${toolName} ${input.pattern ?? 'unknown'}`;
    default:
      return `${toolName} operation`;
  }
}
