import { SvelteMap } from 'svelte/reactivity';
import type { QuestionRequest } from '@agentdeck/core';
import type { QuestionRequestEvent } from '@agentdeck/core/dashboard';
import { instances } from './instances.svelte';

/**
 * Questions store - manages pending question requests from AskUserQuestion tool.
 * Uses SvelteMap for reactive mutations without reassignment.
 * Follows the PermissionStore pattern.
 */
class QuestionStore {
  #questions = $state(new SvelteMap<string, QuestionRequest>());

  /** Get the underlying map (read-only access for iteration) */
  get all() {
    return this.#questions;
  }

  /** Get question count */
  get size() {
    return this.#questions.size;
  }

  /** Derived: all questions as array, sorted by newest first */
  readonly sorted = $derived(
    Array.from(this.#questions.values()).sort((a, b) => b.createdAt - a.createdAt)
  );

  /** Derived: count for badge display */
  readonly count = $derived(this.#questions.size);

  // ========================================
  // Mutations
  // ========================================

  /** Add a question request */
  add(request: QuestionRequest): void {
    this.#questions.set(request.requestId, request);
  }

  /** Get a question request by ID */
  get(requestId: string): QuestionRequest | undefined {
    return this.#questions.get(requestId);
  }

  /** Check if a question request exists */
  has(requestId: string): boolean {
    return this.#questions.has(requestId);
  }

  /** Remove a question request (after user answers) */
  remove(requestId: string): boolean {
    return this.#questions.delete(requestId);
  }

  /** Clear all questions */
  clear(): void {
    this.#questions.clear();
  }

  /** Get questions for a specific instance */
  getByInstance(instanceId: string): QuestionRequest[] {
    return Array.from(this.#questions.values()).filter(q => q.instanceId === instanceId);
  }

  /** Check if an instance has pending questions */
  hasPendingForInstance(instanceId: string): boolean {
    for (const q of this.#questions.values()) {
      if (q.instanceId === instanceId) return true;
    }
    return false;
  }

  /** Get pending questions for a specific instance (alias for getByInstance) */
  getPendingForInstance(instanceId: string): QuestionRequest[] {
    return this.getByInstance(instanceId);
  }

  // ========================================
  // WebSocket Event Handlers
  // ========================================

  /** Handle question:request WebSocket event */
  handleRequest(event: QuestionRequestEvent): void {
    // Store in pending questions map
    this.#questions.set(event.requestId, {
      requestId: event.requestId,
      instanceId: event.instanceId,
      toolUseId: event.toolUseId,
      questions: event.questions,
      createdAt: event.createdAt,
    });

    // Create a system message for the UI to render
    instances.addMessage(event.instanceId, {
      type: 'system.ask_question',
      content: event.questions[0]?.question || 'Question',
      timestamp: new Date(event.createdAt),
      metadata: {
        subtype: 'ask_question',
        questionRequestId: event.requestId,
        questions: event.questions,
      },
    });
  }

  /** Handle question response (remove from pending and update message) */
  handleResponse(requestId: string, answers?: Record<string, string>): void {
    const question = this.#questions.get(requestId);
    if (question && answers) {
      // Update the message with the answers for inactive display
      instances.updateQuestionAnswers(question.instanceId, requestId, answers);
    }
    this.#questions.delete(requestId);
  }
}

// Singleton with HMR persistence
function createQuestionStore(): QuestionStore {
  // @ts-expect-error - globalThis extension for HMR
  if (globalThis.__agentdeckQuestionStore) {
    // @ts-expect-error - globalThis extension for HMR
    return globalThis.__agentdeckQuestionStore;
  }
  const store = new QuestionStore();
  // @ts-expect-error - globalThis extension for HMR
  globalThis.__agentdeckQuestionStore = store;
  return store;
}

export const questions = createQuestionStore();
