/**
 * Shared utilities for displaying tool information in chat UI.
 * Used by ToolGroup.svelte and SubagentBranch.svelte to avoid duplication.
 */

/**
 * Get a brief description/glance for a tool based on its input.
 * Shows the most relevant parameter for quick identification.
 */
export function getToolGlance(
  input: Record<string, unknown> | undefined
): string {
  if (!input) {
    return "";
  }

  // File operations - show path (last 2 segments)
  if (input.file_path) {
    return String(input.file_path).split("/").slice(-2).join("/");
  }
  if (input.path) {
    return String(input.path).split("/").slice(-2).join("/");
  }

  // Bash - show command preview
  if (input.command) {
    const cmd = String(input.command);
    return cmd.length > 40 ? `${cmd.slice(0, 40)}...` : cmd;
  }

  // Search - show pattern
  if (input.pattern) {
    return `/${input.pattern}/`;
  }

  // Glob
  if (input.glob) {
    return String(input.glob);
  }

  // Task/Agent and other described calls — the only readable part of the input
  if (input.description) {
    return String(input.description);
  }

  return "";
}

/**
 * Get a preview/glimpse of a tool result for collapsed view.
 * Returns the first line or first N characters.
 */
export function getResultGlimpse(result: unknown, maxLength = 60): string {
  if (result === undefined || result === null) {
    return "";
  }

  const str = typeof result === "string" ? result : JSON.stringify(result);
  const [firstLine] = str.split("\n");

  if (firstLine.length > maxLength) {
    return `${firstLine.slice(0, maxLength)}...`;
  }
  return firstLine;
}

/**
 * Extract readable text from tool result content.
 * Handles string, array of content blocks, or falls back to JSON.stringify.
 */
export function extractResultText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    // Handle array of content blocks (common for tool results)
    return content
      .map((block: unknown) => {
        if (typeof block === "string") {
          return block;
        }
        if (block && typeof block === "object" && "type" in block) {
          const b = block as { type: string; text?: string };
          if (b.type === "text" && b.text) {
            return b.text;
          }
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return JSON.stringify(content);
}

/**
 * Get tool status from message metadata.
 */
export function getToolStatus(
  metadata: { toolStatus?: string } | undefined
): "pending" | "success" | "error" {
  return (metadata?.toolStatus as "pending" | "success" | "error") || "pending";
}

/**
 * Format tool result as string for display.
 */
export function formatToolResult(result: unknown): string | null {
  if (result === undefined || result === null) {
    return null;
  }
  return typeof result === "string" ? result : JSON.stringify(result, null, 2);
}
