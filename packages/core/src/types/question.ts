/**
 * Question types for AskUserQuestion tool UI bridge
 *
 * These types mirror Claude Code's AskUserQuestion tool structure
 * and enable the dashboard to display interactive question dialogs.
 */

/**
 * A single option in a question
 */
export interface QuestionOption {
  /** Display text for this option */
  label: string;
  /** Explanation of what this option means */
  description: string;
}

/**
 * A single question within a question request
 */
export interface Question {
  /** The complete question to ask the user */
  question: string;
  /** Short label displayed as a chip/tag (max 12 chars) */
  header: string;
  /** Available choices for this question (2-4 options) */
  options: QuestionOption[];
  /** Whether multiple options can be selected */
  multiSelect: boolean;
}

/**
 * Question request sent from agent to hub when Claude uses AskUserQuestion tool
 */
export interface QuestionRequest {
  /** Unique ID for this question request */
  requestId: string;
  /** Instance ID that is asking the question */
  instanceId: string;
  /** SDK's tool use ID for the AskUserQuestion invocation */
  toolUseId: string;
  /** The questions to ask (1-4 questions per request) */
  questions: Question[];
  /** Timestamp when request was created */
  createdAt: number;
}

/**
 * Question response sent from dashboard back to agent
 */
export interface QuestionResponse {
  /** Request ID being responded to */
  requestId: string;
  /** Instance ID */
  instanceId: string;
  /** SDK's tool use ID (for persisting answers to DB) */
  toolUseId?: string;
  /**
   * User's answers indexed by question number.
   * Value is either the selected option label or custom "Other" text.
   * For multiSelect questions, multiple labels are joined with ", "
   */
  answers: Record<string, string>;
}
