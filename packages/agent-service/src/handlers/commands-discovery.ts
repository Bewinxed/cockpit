import { readdir, readFile, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { JsonRpcRequest } from '@cockpit/core';
import { createResponse, createErrorResponse, JsonRpcErrorCode } from '@cockpit/core';
import type {
  CommandsListParams,
  CommandsListResult,
  AvailableCommand,
} from '@cockpit/core/protocol';
import type { HubClient } from '../hub-client.js';
import type { InstanceManager } from '../instance-manager.js';

/**
 * Built-in Claude Code commands
 */
const BUILTIN_COMMANDS: AvailableCommand[] = [
  { name: '/help', type: 'builtin', description: 'Get help with using Claude Code' },
  { name: '/clear', type: 'builtin', description: 'Clear conversation history' },
  { name: '/compact', type: 'builtin', description: 'Clear history and compact context' },
  { name: '/config', type: 'builtin', description: 'View or update configuration' },
  { name: '/cost', type: 'builtin', description: 'Show token usage and cost' },
  { name: '/doctor', type: 'builtin', description: 'Check Claude Code health' },
  { name: '/init', type: 'builtin', description: 'Initialize project with CLAUDE.md' },
  { name: '/login', type: 'builtin', description: 'Switch Claude accounts' },
  { name: '/logout', type: 'builtin', description: 'Sign out of your account' },
  { name: '/memory', type: 'builtin', description: 'Edit CLAUDE.md memory file' },
  { name: '/model', type: 'builtin', description: 'Switch AI model' },
  { name: '/permissions', type: 'builtin', description: 'View or update permissions' },
  { name: '/pr-comments', type: 'builtin', description: 'View PR comments' },
  { name: '/review', type: 'builtin', description: 'Request code review' },
  { name: '/status', type: 'builtin', description: 'View system status' },
  { name: '/terminal-setup', type: 'builtin', description: 'Install shell integration' },
  { name: '/vim', type: 'builtin', description: 'Toggle vim mode' },
];

/**
 * Discover custom commands from a directory
 */
async function discoverCustomCommands(cwd: string): Promise<AvailableCommand[]> {
  const commands: AvailableCommand[] = [];

  // Check for .claude/commands directory
  const commandsDir = join(cwd, '.claude', 'commands');

  try {
    const dirStat = await stat(commandsDir);
    if (!dirStat.isDirectory()) {
      return commands;
    }

    const entries = await readdir(commandsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue;
      }

      const commandName = basename(entry.name, '.md');
      const filePath = join(commandsDir, entry.name);

      try {
        // Try to read first line for description
        const content = await readFile(filePath, 'utf-8');
        const firstLine = content.split('\n')[0].trim();

        // Check if first line is a markdown heading or description
        let description = `Custom command from ${entry.name}`;
        if (firstLine.startsWith('#')) {
          description = firstLine.replace(/^#+\s*/, '');
        } else if (firstLine.length > 0 && firstLine.length < 100) {
          description = firstLine;
        }

        commands.push({
          name: `/${commandName}`,
          type: 'custom',
          description,
          source: filePath,
        });
      } catch {
        // If we can't read the file, still add the command
        commands.push({
          name: `/${commandName}`,
          type: 'custom',
          description: `Custom command from ${entry.name}`,
          source: filePath,
        });
      }
    }
  } catch {
    // Directory doesn't exist or isn't accessible
  }

  return commands;
}

/**
 * Handle commands.list requests from the hub
 */
export async function handleCommandsList(
  request: JsonRpcRequest,
  _instanceManager: InstanceManager,
  hubClient: HubClient
): Promise<void> {
  const params = request.params as CommandsListParams | undefined;

  if (!params?.instanceId || !params?.cwd) {
    hubClient.sendResponse(
      createErrorResponse(
        request.id,
        JsonRpcErrorCode.INVALID_PARAMS,
        'Missing required params: instanceId and cwd'
      )
    );
    return;
  }

  try {
    // Discover custom commands from the working directory
    const customCommands = await discoverCustomCommands(params.cwd);

    // Combine built-in and custom commands
    const allCommands: AvailableCommand[] = [
      ...BUILTIN_COMMANDS,
      ...customCommands,
    ];

    // Sort by name
    allCommands.sort((a, b) => a.name.localeCompare(b.name));

    const result: CommandsListResult = {
      commands: allCommands,
    };

    hubClient.sendResponse(createResponse(request.id, result));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    hubClient.sendResponse(
      createErrorResponse(
        request.id,
        JsonRpcErrorCode.INTERNAL_ERROR,
        `Failed to list commands: ${message}`
      )
    );
  }
}

export default { handleCommandsList };
