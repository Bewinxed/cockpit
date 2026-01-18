import { readdir, stat, realpath } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { JsonRpcRequest } from '@cockpit/core';
import { createResponse, createErrorResponse, JsonRpcErrorCode } from '@cockpit/core';
import type {
  FilesystemListParams,
  FilesystemListResult,
  FilesystemEntry,
} from '@cockpit/core/protocol';
import type { HubClient } from '../hub-client.js';

/**
 * Handle filesystem.list requests from the hub
 */
export async function handleFilesystemList(
  request: JsonRpcRequest,
  hubClient: HubClient
): Promise<void> {
  const params = request.params as FilesystemListParams | undefined;

  // Default to home directory if no path specified
  const home = homedir();
  const requestedPath = params?.path || home;
  const targetPath = resolve(requestedPath);

  try {
    // Check if directory exists and is accessible
    const stats = await stat(targetPath);

    if (!stats.isDirectory()) {
      hubClient.sendResponse(
        createErrorResponse(
          request.id,
          JsonRpcErrorCode.INVALID_PARAMS,
          `Path is not a directory: ${targetPath}`
        )
      );
      return;
    }

    // Read directory entries
    const dirEntries = await readdir(targetPath, { withFileTypes: true });

    // Map to FilesystemEntry format
    const entries: FilesystemEntry[] = await Promise.all(
      dirEntries
        .filter(entry => !entry.name.startsWith('.')) // Hide hidden files
        .sort((a, b) => {
          // Directories first, then alphabetically
          if (a.isDirectory() !== b.isDirectory()) {
            return a.isDirectory() ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        })
        .map(async (entry) => {
          const entryPath = join(targetPath, entry.name);
          let isSymlink = entry.isSymbolicLink();
          let isDirectory = entry.isDirectory();
          let size: number | undefined;
          let modifiedAt: string | undefined;

          try {
            // For symlinks, check if they point to a directory
            if (isSymlink) {
              const realPath = await realpath(entryPath);
              const realStats = await stat(realPath);
              isDirectory = realStats.isDirectory();
            }

            // Get file stats
            const entryStats = await stat(entryPath);
            if (!isDirectory) {
              size = entryStats.size;
            }
            modifiedAt = entryStats.mtime.toISOString();
          } catch {
            // If we can't stat the entry, just use what we have
          }

          return {
            name: entry.name,
            path: entryPath,
            isDirectory,
            isSymlink,
            size,
            modifiedAt,
          };
        })
    );

    // Calculate parent path
    const parent = targetPath === '/' ? null : dirname(targetPath);

    const result: FilesystemListResult = {
      path: targetPath,
      parent,
      entries,
      home,
    };

    hubClient.sendResponse(createResponse(request.id, result));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Check for permission denied
    if ((error as NodeJS.ErrnoException).code === 'EACCES') {
      hubClient.sendResponse(
        createErrorResponse(
          request.id,
          JsonRpcErrorCode.INVALID_PARAMS,
          `Permission denied: ${targetPath}`
        )
      );
      return;
    }

    // Check for not found
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      hubClient.sendResponse(
        createErrorResponse(
          request.id,
          JsonRpcErrorCode.INVALID_PARAMS,
          `Directory not found: ${targetPath}`
        )
      );
      return;
    }

    hubClient.sendResponse(
      createErrorResponse(
        request.id,
        JsonRpcErrorCode.INTERNAL_ERROR,
        `Failed to list directory: ${message}`
      )
    );
  }
}

export default { handleFilesystemList };
