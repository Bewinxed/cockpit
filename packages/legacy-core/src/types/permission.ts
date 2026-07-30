/**
 * Permission types for tool usage control
 */

/** Permission update destination */
export type PermissionUpdateDestination = 'userSettings' | 'projectSettings' | 'localSettings' | 'session' | 'cliArg';

/** Permission behavior */
export type PermissionBehavior = 'allow' | 'deny' | 'ask';

/** Permission rule value */
export interface PermissionRuleValue {
  toolName: string;
  ruleContent?: string;
}

/** Permission update - for "always allow" type functionality */
export type PermissionUpdate = {
  type: 'addRules';
  rules: PermissionRuleValue[];
  behavior: PermissionBehavior;
  destination: PermissionUpdateDestination;
} | {
  type: 'replaceRules';
  rules: PermissionRuleValue[];
  behavior: PermissionBehavior;
  destination: PermissionUpdateDestination;
} | {
  type: 'removeRules';
  rules: PermissionRuleValue[];
  behavior: PermissionBehavior;
  destination: PermissionUpdateDestination;
} | {
  type: 'setMode';
  mode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'delegate' | 'dontAsk';
  destination: PermissionUpdateDestination;
} | {
  type: 'addDirectories';
  directories: string[];
  destination: PermissionUpdateDestination;
} | {
  type: 'removeDirectories';
  directories: string[];
  destination: PermissionUpdateDestination;
};

/**
 * Permission request sent from agent to hub when tool needs approval
 */
export interface PermissionRequest {
  /** Unique ID for this permission request */
  requestId: string;
  /** Instance ID that needs permission */
  instanceId: string;
  /** Tool that needs permission */
  toolName: string;
  /** Tool input parameters */
  toolInput: Record<string, unknown>;
  /** SDK's tool use ID */
  toolUseID: string;
  /** Why this permission is being requested */
  decisionReason?: string;
  /** File path that triggered the request, if applicable */
  blockedPath?: string;
  /** Sub-agent ID if in a sub-agent */
  agentID?: string;
  /** Suggestions for "always allow" - user can choose to apply these */
  suggestions?: PermissionUpdate[];
  /** Timestamp when request was created */
  createdAt: number;
}

/**
 * Permission response sent from dashboard back to agent
 */
export interface PermissionResponse {
  /** Request ID being responded to */
  requestId: string;
  /** Instance ID */
  instanceId: string;
  /** Whether to allow or deny */
  behavior: 'allow' | 'deny';
  /** For allow: optionally modified tool input */
  updatedInput?: Record<string, unknown>;
  /** For allow: permission updates to apply (e.g., "always allow for session") */
  updatedPermissions?: PermissionUpdate[];
  /** For deny: message explaining why or guidance for model */
  message?: string;
  /** For deny: whether to interrupt execution completely */
  interrupt?: boolean;
}
