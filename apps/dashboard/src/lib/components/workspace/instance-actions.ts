/**
 * Instance actions — message sending, interrupting, editing, and question handling.
 */

import { instances, sendInstanceMessage, sendQuestionResponse, questions as questionsStore } from '$lib/stores';
import type { Message } from '$lib/stores';
import { api } from '$lib/api';
import { resumeInstance } from '$lib/actions';

// ============================================
// Send message
// ============================================

export interface SendContext {
  instanceId: string;
  instance: { status?: string } | undefined;
  isActive: boolean;
}

export interface SendResult {
  error?: string;
  needsResume?: boolean;
}

/**
 * Send a regular (non-command) message to a running instance.
 * Returns error string if something went wrong.
 */
export async function sendMessage(
  instanceId: string,
  message: string,
): Promise<SendResult> {
  try {
    const result = await sendInstanceMessage({ instanceId, message });

    if (!result.success) {
      const errMsg = result.error || 'Failed to send message';
      const responseCode = (result as { code?: string }).code;

      const needsResume =
        errMsg.toLowerCase().includes('not found') ||
        errMsg.toLowerCase().includes('not running') ||
        responseCode === 'INSTANCE_NOT_RUNNING';

      if (needsResume) {
        return { needsResume: true };
      }

      return { error: errMsg };
    }

    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Resume a stopped/sleeping instance and optionally send a message.
 */
export async function resumeAndSend(
  instanceId: string,
  prompt: string,
): Promise<SendResult> {
  try {
    const result = await api.api.instances({ id: instanceId }).resume.post({ prompt });
    if (result.error || !result.data?.success) {
      const errorObj = result.error as { error?: string; message?: string } | undefined;
      const dataObj = result.data as { error?: string } | undefined;
      const errorMsg = errorObj?.error || errorObj?.message || dataObj?.error || 'Failed to resume session';
      return { error: errorMsg };
    }
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Fallback resume via the resumeInstance action.
 */
export async function fallbackResume(instanceId: string, message: string): Promise<SendResult> {
  try {
    const resumeResult = await resumeInstance(instanceId, message);
    if (!resumeResult.success) {
      return { error: resumeResult.error || 'Failed to resume' };
    }
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to resume' };
  }
}

// ============================================
// Edit message
// ============================================

export async function editMessage(
  instanceId: string,
  messageId: string,
  newContent: string,
  currentMessages: Message[],
): Promise<{ error?: string }> {
  const msgIndex = currentMessages.findIndex(m => m.id === messageId);
  if (msgIndex === -1) return {};

  const editedMessage = currentMessages[msgIndex];
  let resumeFromUuid: string | undefined;

  if (msgIndex > 0) {
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (currentMessages[i].sdkUuid) {
        resumeFromUuid = currentMessages[i].sdkUuid;
        break;
      }
    }
  }

  const messageIdForDelete = editedMessage.sdkUuid ?? editedMessage.id;
  if (!resumeFromUuid && messageIdForDelete) {
    try {
      await fetch(`/api/instances/${instanceId}/messages/after/${encodeURIComponent(messageIdForDelete)}`, {
        method: 'DELETE'
      });
    } catch {
      // Ignore
    }
  }

  // Clear and re-add messages before the edit point
  // Subagents are derived from messages, so clearing messages automatically clears subagents
  const messagesToKeep = currentMessages.slice(0, msgIndex);
  instances.clearMessages(instanceId);
  for (const msg of messagesToKeep) {
    instances.addMessage(instanceId, msg);
  }

  // Add edited message
  instances.addMessage(instanceId, {
    type: 'user',
    content: newContent,
    timestamp: new Date(),
  });

  try {
    const resumeParams: {
      prompt: string;
      resumeFromMessageId?: string;
      forkSession?: boolean;
    } = { prompt: newContent };

    if (resumeFromUuid) {
      resumeParams.resumeFromMessageId = resumeFromUuid;
      resumeParams.forkSession = true;
    }

    const result = await api.api.instances({ id: instanceId }).resume.post(resumeParams);
    if (result.error || !result.data?.success) {
      // Eden Treaty puts error response body in result.error, successful but failed response in result.data
      const errorObj = result.error as { error?: string; message?: string } | undefined;
      const dataObj = result.data as { error?: string } | undefined;
      const errorMsg = errorObj?.error || errorObj?.message || dataObj?.error || 'Failed to resume';
      return { error: errorMsg };
    }
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to edit message' };
  }
}

// ============================================
// Interrupt
// ============================================

export async function interruptInstance(instanceId: string): Promise<{ error?: string }> {
  try {
    const result = await api.api.instances({ id: instanceId }).interrupt.post();
    if (result.error || !result.data?.success) {
      return { error: (result.error as { message?: string })?.message || 'Failed to interrupt' };
    }
    instances.addMessage(instanceId, {
      type: 'system.notice',
      content: 'Operation interrupted',
      timestamp: new Date(),
    });
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ============================================
// Question (AskUserQuestion)
// ============================================

export async function submitQuestionResponse(
  instanceId: string,
  requestId: string,
  answers: Record<string, string>,
): Promise<void> {
  const question = questionsStore.get(requestId);
  const toolUseId = question?.toolUseId;

  const response = await sendQuestionResponse({ requestId, instanceId, toolUseId, answers });
  if (!response.success) {
    throw new Error(response.error || 'Failed to submit answer');
  }
  questionsStore.handleResponse(requestId, answers);
}

export function cancelQuestion(instanceId: string): void {
  const pending = questionsStore.getByInstance(instanceId);
  if (pending.length > 0) {
    questionsStore.remove(pending[0].requestId);
  }
}
