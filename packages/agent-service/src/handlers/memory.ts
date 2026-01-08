import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { JsonRpcRequest } from '@cockpit/core';
import { createResponse, createErrorResponse, JSON_RPC_ERROR_CODES } from '@cockpit/core';
import type {
  MemoryReadParams,
  MemoryReadResult,
  MemoryWriteParams,
  MemoryWriteResult,
} from '@cockpit/core/protocol';
import type { HubClient } from '../hub-client.js';

/**
 * Get the path to a memory file
 */
function getMemoryPath(type: 'project' | 'user', cwd?: string): string {
  if (type === 'project') {
    // Project memory: ./CLAUDE.md in the working directory
    return join(cwd || process.cwd(), 'CLAUDE.md');
  } else {
    // User memory: ~/.claude/CLAUDE.md
    return join(homedir(), '.claude', 'CLAUDE.md');
  }
}

/**
 * Handle memory.read requests from the hub
 */
export async function handleMemoryRead(
  request: JsonRpcRequest,
  hubClient: HubClient
): Promise<void> {
  const params = request.params as MemoryReadParams | undefined;

  if (!params?.type) {
    hubClient.sendResponse(
      createErrorResponse(
        request.id,
        JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        'Missing required parameter: type'
      )
    );
    return;
  }

  const memoryPath = getMemoryPath(params.type, params.cwd);

  try {
    const content = await readFile(memoryPath, 'utf-8');

    const result: MemoryReadResult = {
      content,
      path: memoryPath,
      exists: true,
    };

    hubClient.sendResponse(createResponse(request.id, result));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // File doesn't exist - return empty content
      const result: MemoryReadResult = {
        content: '',
        path: memoryPath,
        exists: false,
      };
      hubClient.sendResponse(createResponse(request.id, result));
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    hubClient.sendResponse(
      createErrorResponse(
        request.id,
        JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
        `Failed to read memory file: ${message}`
      )
    );
  }
}

/**
 * Handle memory.write requests from the hub
 */
export async function handleMemoryWrite(
  request: JsonRpcRequest,
  hubClient: HubClient
): Promise<void> {
  const params = request.params as MemoryWriteParams | undefined;

  if (!params?.type || params.content === undefined) {
    hubClient.sendResponse(
      createErrorResponse(
        request.id,
        JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        'Missing required parameters: type and content'
      )
    );
    return;
  }

  const memoryPath = getMemoryPath(params.type, params.cwd);

  try {
    // Ensure directory exists
    await mkdir(dirname(memoryPath), { recursive: true });

    // Write the content
    await writeFile(memoryPath, params.content, 'utf-8');

    const result: MemoryWriteResult = {
      success: true,
      path: memoryPath,
    };

    hubClient.sendResponse(createResponse(request.id, result));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    hubClient.sendResponse(
      createErrorResponse(
        request.id,
        JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
        `Failed to write memory file: ${message}`
      )
    );
  }
}

export default { handleMemoryRead, handleMemoryWrite };
