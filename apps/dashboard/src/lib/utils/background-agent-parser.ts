/**
 * Parser for background agent TaskOutput results.
 *
 * Background agents don't stream their messages live - instead, when TaskOutput
 * retrieves their result, it comes as a single text block with embedded tool uses
 * formatted like:
 *
 * [Tool: ToolName] {"input": "value"}
 * [Tool: ToolName] {"input": "value"}
 *
 * --- RESULT ---
 * <actual result text>
 *
 * This parser extracts the tool uses and result text without using regex.
 */

export interface ParsedToolUse {
  toolName: string;
  input: Record<string, unknown>;
}

export interface ParsedBackgroundAgentOutput {
  /** Tool uses extracted from the output (deduplicated) */
  toolUses: ParsedToolUse[];
  /** The final result text after "--- RESULT ---" */
  resultText: string;
  /** The raw output before any parsing */
  rawOutput: string;
}

const TOOL_PREFIX = '[Tool: ';
const RESULT_SEPARATOR = '--- RESULT ---';

/**
 * Parse a background agent's TaskOutput result into structured data.
 * Uses string methods instead of regex for robustness.
 */
export function parseBackgroundAgentOutput(output: string): ParsedBackgroundAgentOutput {
  const result: ParsedBackgroundAgentOutput = {
    toolUses: [],
    resultText: '',
    rawOutput: output,
  };

  if (!output) {
    return result;
  }

  // Split on the result separator to get tools section and result section
  const separatorIndex = output.indexOf(RESULT_SEPARATOR);

  let toolsSection: string;
  let resultSection: string;

  if (separatorIndex !== -1) {
    toolsSection = output.slice(0, separatorIndex);
    resultSection = output.slice(separatorIndex + RESULT_SEPARATOR.length).trim();
  } else {
    // No separator - entire output is the result
    toolsSection = '';
    resultSection = output.trim();
  }

  result.resultText = resultSection;

  // Parse tool uses from the tools section
  if (toolsSection) {
    const lines = toolsSection.split('\n');
    const seenTools = new Set<string>(); // For deduplication

    for (const line of lines) {
      const trimmedLine = line.trim();

      // Check if line starts with tool prefix
      if (!trimmedLine.startsWith(TOOL_PREFIX)) {
        continue;
      }

      // Find the closing bracket for tool name
      const closingBracket = trimmedLine.indexOf(']', TOOL_PREFIX.length);
      if (closingBracket === -1) {
        continue;
      }

      // Extract tool name
      const toolName = trimmedLine.slice(TOOL_PREFIX.length, closingBracket);
      if (!toolName) {
        continue;
      }

      // Extract JSON input (everything after the closing bracket and space)
      const jsonStart = closingBracket + 1;
      let jsonStr = trimmedLine.slice(jsonStart).trim();

      // Skip if no JSON
      if (!jsonStr) {
        continue;
      }

      // Try to parse the JSON
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(jsonStr);
      } catch {
        // If JSON parsing fails, store as raw string
        input = { raw: jsonStr };
      }

      // Create a dedup key based on tool name and input
      const dedupKey = toolName + ':' + JSON.stringify(input);
      if (seenTools.has(dedupKey)) {
        continue; // Skip duplicate
      }
      seenTools.add(dedupKey);

      result.toolUses.push({
        toolName,
        input,
      });
    }
  }

  return result;
}

/**
 * Convert parsed tool uses into Message objects for display in SubagentBranch.
 */
export function toolUsesToMessages(
  toolUses: ParsedToolUse[],
  resultText: string
): Array<{ type: 'tool.use' | 'assistant'; content: string; toolName?: string; toolInput?: Record<string, unknown>; timestamp: Date }> {
  const messages: Array<{ type: 'tool.use' | 'assistant'; content: string; toolName?: string; toolInput?: Record<string, unknown>; timestamp: Date }> = [];
  const now = new Date();

  // Add tool use messages
  for (const toolUse of toolUses) {
    messages.push({
      type: 'tool.use',
      content: toolUse.toolName,
      toolName: toolUse.toolName,
      toolInput: toolUse.input,
      timestamp: now,
    });
  }

  // Add the final result as an assistant message
  if (resultText) {
    messages.push({
      type: 'assistant',
      content: resultText,
      timestamp: now,
    });
  }

  return messages;
}
