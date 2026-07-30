/**
 * River.ts Event Definitions for Dashboard WebSocket
 *
 * Uses river.ts RiverEvents to create type-safe event schemas with
 * request/response support for RPC-style commands.
 */

import { RiverEvents } from 'river.ts';
import type {
  AgentConnectedEvent,
  AgentDisconnectedEvent,
  AgentReconnectingEvent,
  AgentUpdatedEvent,
  InstanceCreatedEvent,
  InstanceStartedEvent,
  InstanceStoppedEvent,
  InstanceSleepingEvent,
  InstanceErrorEvent,
  InstanceResumedEvent,
  InstanceTokenUsageEvent,
  InstanceModelChangedEvent,
  InstanceViewModeChangedEvent,
  InstanceThinkingChangedEvent,
  InstanceTurnEvent,
  MessageCreatedEvent,
  MessageStreamEvent,
  SdkMessageEvent,
  TaskCreatedEvent,
  TaskUpdatedEvent,
  TaskCompletedEvent,
  PermissionRequestEvent,
  QuestionRequestEvent,
  ProjectCreatedEvent,
  ProjectUpdatedEvent,
  ProjectDeletedEvent,
  ConnectedEvent,
} from './types.js';
import type { PermissionResponse, QuestionResponse } from '../types/index.js';
import type { ThinkingMode } from '../protocol/commands.js';

// ============================================================================
// Command Request/Response Types (for RPC-style operations)
// ============================================================================

/** Spawn a new Claude instance */
export interface SpawnInstanceRequest {
  machineId: string;
  cwd: string;
  model?: string;
  projectId?: string;
  permissionMode?: string;
  resumeSessionId?: string;
  allowThinking?: boolean;
  /** Max agentic turns before stopping */
  maxTurns?: number;
  /** Max budget in USD */
  maxBudgetUsd?: number;
  /** Custom system prompt additions */
  systemPrompt?: string;
  /** Environment variables */
  envVars?: Record<string, string>;
  /** Whitelist of allowed tools */
  allowedTools?: string[];
  /** Blacklist of disallowed tools */
  disallowedTools?: string[];
}

/** Set thinking mode on an instance */
export interface SetThinkingRequest {
  instanceId: string;
  mode: ThinkingMode;
}

export interface SetThinkingResponse {
  success: boolean;
  mode?: ThinkingMode;
  error?: string;
}

/** Update instance preferences (view mode, etc.) */
export interface UpdateInstancePreferencesRequest {
  instanceId: string;
  viewMode: 'flow' | 'chat';
}

export interface UpdateInstancePreferencesResponse {
  success: boolean;
  error?: string;
}

export interface SpawnInstanceResponse {
  instanceId: string;
  status: 'created' | 'error';
  error?: string;
}

/** Send a message to an instance */
export interface SendMessageRequest {
  instanceId: string;
  message: string;
}

export interface SendMessageResponse {
  success: boolean;
  error?: string;
}

/** Stop an instance */
export interface StopInstanceRequest {
  instanceId: string;
}

export interface StopInstanceResponse {
  success: boolean;
  error?: string;
}

/** Permission response (user allow/deny) */
export interface PermissionResponseRequest extends PermissionResponse {
  // Inherits: requestId, instanceId, behavior, updatedInput?, updatedPermissions?, message?, interrupt?
}

export interface PermissionResponseResponse {
  success: boolean;
  error?: string;
}

/** Question response (user answers) */
export interface QuestionResponseRequest extends QuestionResponse {
  // Inherits: requestId, instanceId, answers
}

export interface QuestionResponseResponse {
  success: boolean;
  error?: string;
}

// ============================================================================
// River Events Definition
// ============================================================================

/**
 * Build the river.ts events schema for dashboard WebSocket.
 *
 * Events use `data` for payload type.
 * Commands use `data` for request and `response` for response type.
 */
export function buildDashboardEvents() {
  return new RiverEvents()
    // Connection events
    .defineEvent('connected', {
      data: {} as ConnectedEvent,
    })

    // Agent events
    .defineEvent('agent:connected', {
      data: {} as AgentConnectedEvent,
    })
    .defineEvent('agent:disconnected', {
      data: {} as AgentDisconnectedEvent,
    })
    .defineEvent('agent:reconnecting', {
      data: {} as AgentReconnectingEvent,
    })
    .defineEvent('agent:updated', {
      data: {} as AgentUpdatedEvent,
    })

    // Instance lifecycle events
    .defineEvent('instance:created', {
      data: {} as InstanceCreatedEvent,
    })
    .defineEvent('instance:started', {
      data: {} as InstanceStartedEvent,
    })
    .defineEvent('instance:stopped', {
      data: {} as InstanceStoppedEvent,
    })
    .defineEvent('instance:sleeping', {
      data: {} as InstanceSleepingEvent,
    })
    .defineEvent('instance:error', {
      data: {} as InstanceErrorEvent,
    })
    .defineEvent('instance:resumed', {
      data: {} as InstanceResumedEvent,
    })
    .defineEvent('instance:token_usage', {
      data: {} as InstanceTokenUsageEvent,
    })
    .defineEvent('instance:model-changed', {
      data: {} as InstanceModelChangedEvent,
    })
    .defineEvent('instance:viewMode-changed', {
      data: {} as InstanceViewModeChangedEvent,
    })
    .defineEvent('instance:thinking-changed', {
      data: {} as InstanceThinkingChangedEvent,
    })
    .defineEvent('instance:turn', {
      data: {} as InstanceTurnEvent,
    })

    // Message events
    .defineEvent('message:created', {
      data: {} as MessageCreatedEvent,
    })
    .defineEvent('message:stream', {
      data: {} as MessageStreamEvent,
    })
    .defineEvent('sdk:message', {
      data: {} as SdkMessageEvent,
    })

    // Task events
    .defineEvent('task:created', {
      data: {} as TaskCreatedEvent,
    })
    .defineEvent('task:updated', {
      data: {} as TaskUpdatedEvent,
    })
    .defineEvent('task:completed', {
      data: {} as TaskCompletedEvent,
    })

    // Permission events
    .defineEvent('permission:request', {
      data: {} as PermissionRequestEvent,
    })

    // Question events
    .defineEvent('question:request', {
      data: {} as QuestionRequestEvent,
    })

    // Project events
    .defineEvent('project:created', {
      data: {} as ProjectCreatedEvent,
    })
    .defineEvent('project:updated', {
      data: {} as ProjectUpdatedEvent,
    })
    .defineEvent('project:deleted', {
      data: {} as ProjectDeletedEvent,
    })

    // ========================================================================
    // Commands (RPC-style with request/response)
    // ========================================================================

    .defineEvent('instance.spawn', {
      data: {} as SpawnInstanceRequest,
      response: {} as SpawnInstanceResponse,
    })
    .defineEvent('instance.send', {
      data: {} as SendMessageRequest,
      response: {} as SendMessageResponse,
    })
    .defineEvent('instance.stop', {
      data: {} as StopInstanceRequest,
      response: {} as StopInstanceResponse,
    })
    .defineEvent('permission.response', {
      data: {} as PermissionResponseRequest,
      response: {} as PermissionResponseResponse,
    })
    .defineEvent('question.response', {
      data: {} as QuestionResponseRequest,
      response: {} as QuestionResponseResponse,
    })
    .defineEvent('instance.updatePreferences', {
      data: {} as UpdateInstancePreferencesRequest,
      response: {} as UpdateInstancePreferencesResponse,
    })
    .defineEvent('instance.setThinking', {
      data: {} as SetThinkingRequest,
      response: {} as SetThinkingResponse,
    })

    .build();
}

/**
 * Pre-built dashboard events schema
 */
export const dashboardEvents = buildDashboardEvents();

/**
 * Type of the built events schema
 */
export type DashboardEventsSchema = ReturnType<typeof buildDashboardEvents>;
