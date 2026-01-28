/**
 * Dashboard Events Module
 *
 * Provides type-safe event definitions for real-time communication
 * between hub-server and dashboard via WebSocket.
 */

// Event type definitions
export * from './types.js';

// River.ts event schema builder
export {
  buildDashboardEvents,
  dashboardEvents,
  type DashboardEventsSchema,
  type SpawnInstanceRequest,
  type SpawnInstanceResponse,
  type SendMessageRequest,
  type SendMessageResponse,
  type StopInstanceRequest,
  type StopInstanceResponse,
  type PermissionResponseRequest,
  type PermissionResponseResponse,
  type QuestionResponseRequest,
  type QuestionResponseResponse,
  type UpdateInstancePreferencesRequest,
  type UpdateInstancePreferencesResponse,
  type SetThinkingRequest,
  type SetThinkingResponse,
} from './river.js';
