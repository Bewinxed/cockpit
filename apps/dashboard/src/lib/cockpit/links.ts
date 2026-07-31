/**
 * How a stored session addresses itself in the URL bar. The route id is the SDK
 * `sessionId` and the machine it lives on rides in the query, so a transcript
 * link is shareable and survives a reload with nothing cached.
 */
import type { SDKSessionInfo } from '@cockpit/core';

export function transcriptHref(machineId: string, info: SDKSessionInfo): string {
  const query = new URLSearchParams({ machine: machineId });
  if (info.cwd) query.set('cwd', info.cwd);
  return `/session/${info.sessionId}?${query}`;
}

export function sessionTitle(info: SDKSessionInfo): string {
  return info.customTitle || info.summary || info.firstPrompt || 'untitled session';
}
