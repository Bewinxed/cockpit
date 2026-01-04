/**
 * Error utility functions
 */

/**
 * Extract a human-readable error message from various error types
 * Handles Eden Treaty errors, Error objects, strings, and plain objects
 */
export function extractErrorMessage(error: unknown): string {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;

  // Handle Error instances - but check for Eden Treaty's custom properties first
  if (error instanceof Error) {
    const err = error as Error & { value?: unknown; status?: number };
    // Eden Treaty attaches response body to error.value
    if (typeof err.value === 'object' && err.value !== null) {
      const value = err.value as Record<string, unknown>;
      if (typeof value.error === 'string') return value.error;
      if (typeof value.message === 'string') return value.message;
    }
    // Fall back to error.message if it's a real string (not "[object Object]")
    if (err.message && !err.message.includes('[object Object]')) {
      return err.message;
    }
  }

  if (typeof error === 'object' && error !== null) {
    const errObj = error as Record<string, unknown>;
    // Eden Treaty error format (for non-Error objects)
    if (typeof errObj.value === 'object' && errObj.value !== null) {
      const value = errObj.value as Record<string, unknown>;
      if (typeof value.error === 'string') return value.error;
      if (typeof value.message === 'string') return value.message;
    }
    // Standard error object
    if (typeof errObj.error === 'string') return errObj.error;
    if (typeof errObj.message === 'string') return errObj.message;
    // Last resort: stringify if it has content
    try {
      const str = JSON.stringify(errObj);
      if (str !== '{}') return str;
    } catch {
      // Ignore stringify errors
    }
  }

  return 'An unexpected error occurred';
}
