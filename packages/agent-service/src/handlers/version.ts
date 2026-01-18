import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { JsonRpcRequest } from '@cockpit/core';
import { createResponse, createErrorResponse, JsonRpcErrorCode } from '@cockpit/core';
import type { ClaudeVersionResult } from '@cockpit/core/protocol';
import type { HubClient } from '../hub-client.js';

const execAsync = promisify(exec);

// Cache the version to avoid repeated calls
let cachedVersion: string | null = null;

/**
 * Get Claude CLI version by running `claude --version`
 */
async function getClaudeVersion(): Promise<string> {
  if (cachedVersion) {
    return cachedVersion;
  }

  try {
    const { stdout } = await execAsync('claude --version');
    // Output format is typically "2.0.55" or similar
    const version = stdout.trim();
    cachedVersion = version;
    return version;
  } catch {
    throw new Error('Claude CLI not found or version command failed');
  }
}

/**
 * Handle claude.version requests from the hub
 */
export async function handleClaudeVersion(
  request: JsonRpcRequest,
  hubClient: HubClient
): Promise<void> {
  try {
    const version = await getClaudeVersion();

    const result: ClaudeVersionResult = {
      version,
    };

    hubClient.sendResponse(createResponse(request.id, result));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    hubClient.sendResponse(
      createErrorResponse(
        request.id,
        JsonRpcErrorCode.INTERNAL_ERROR,
        `Failed to get Claude version: ${message}`
      )
    );
  }
}

export default { handleClaudeVersion };
