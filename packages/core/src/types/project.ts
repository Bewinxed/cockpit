/**
 * Project-specific settings and preferences
 */
export interface ProjectSettings {
  /** Default model to use for this project */
  defaultModel?: string;

  /** Default permission mode for instances */
  defaultPermissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions';

  /** Environment variables to inject into instances */
  envVars?: Record<string, string>;

  /** Custom system prompt additions */
  systemPromptAdditions?: string;

  /** Maximum cost allowed per instance (USD) */
  maxCostPerInstance?: number;

  /** Maximum cost allowed per day (USD) */
  maxCostPerDay?: number;
}

/**
 * Represents a project or workspace that can contain Claude Code instances.
 * Projects help organize work and can be associated with specific agents.
 */
export interface Project {
  /** Unique identifier for the project */
  id: string;

  /** Human-readable project name */
  name: string;

  /** Optional description of the project */
  description?: string;

  /** Root path of the project on the agent's filesystem */
  rootPath?: string;

  /** Agent this project is associated with (if any) */
  agentId?: string;

  /** Project-specific settings */
  settings?: ProjectSettings;

  /** When the project was created */
  createdAt: Date;

  /** When the project was last updated */
  updatedAt: Date;
}

/**
 * Data required to create a new project
 */
export interface CreateProjectData {
  name: string;
  description?: string;
  rootPath?: string;
  agentId?: string;
  settings?: ProjectSettings;
}

/**
 * Data for updating an existing project
 */
export interface UpdateProjectData {
  name?: string;
  description?: string;
  rootPath?: string;
  agentId?: string;
  settings?: ProjectSettings;
}
