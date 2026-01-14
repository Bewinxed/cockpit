# fn-8.1 Remove string-matching from isAuthError in actions.ts

## Description

Fix the `isAuthError()` function in `apps/dashboard/src/lib/actions.ts` to use only error codes for auth detection, removing the fragile string-matching pattern.

**Current (bad):**
```typescript
function isAuthError(error: unknown): boolean {
  const errorStr = extractErrorMessage(error).toLowerCase();
  if (errorStr.includes('auth') || errorStr.includes('login') || errorStr.includes('credential')) {
    return true;
  }
  // Also checks error codes at line 35
}
```

**Target:**
```typescript
function isAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const errObj = error as Record<string, unknown>;
  return typeof errObj.code === 'number' && AUTH_ERROR_CODES.includes(errObj.code);
}
```

**File:** `apps/dashboard/src/lib/actions.ts`, lines 29-40

## Acceptance

- [ ] String matching (.includes()) removed from isAuthError
- [ ] Only error code checking remains
- [ ] AUTH_ERROR_CODES constant is the single source of truth
- [ ] LSP shows no errors

## Done summary
## fn-8.1: Remove string-matching from isAuthError

### Changes Made
Simplified `isAuthError()` function in `actions.ts` to use only error codes.

**Before (bad):**
```typescript
function isAuthError(error: unknown): boolean {
  const errorStr = extractErrorMessage(error).toLowerCase();
  if (errorStr.includes('auth') || errorStr.includes('login') || errorStr.includes('credential')) {
    return true;
  }
  // Also checked error codes...
}
```

**After (good):**
```typescript
function isAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const errObj = error as Record<string, unknown>;
  return typeof errObj.code === 'number' && AUTH_ERROR_CODES.includes(errObj.code);
}
```

Auth is properly handled via SDK messages with `subtype: 'login_prompt'`, not error string matching.
## Evidence
- Commits:
- Tests:
- PRs: