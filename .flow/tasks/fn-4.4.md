# fn-4.4 Add Result Error Subtype Renderers

## Description

Add dedicated renderers for SDK result error subtypes with specific UX and recovery options.

### Context
SDK `ResultMessage` has these error subtypes that currently show as generic errors:
- `error_max_turns` - Session hit turn limit
- `error_during_execution` - Error during tool execution
- `error_max_budget_usd` - Cost budget exceeded
- `error_max_structured_output_retries` - Structured output validation failed

### Target State
Each error subtype shows specific UI with:
- Clear error explanation
- Recovery suggestions
- Action buttons where applicable

### Implementation Details

```svelte
<!-- apps/dashboard/src/lib/components/features/message-renderers/ResultError.svelte -->
<script lang="ts">
  import { AlertTriangle, DollarSign, RotateCcw, Settings } from 'lucide-svelte';

  interface Props {
    subtype: 'error_max_turns' | 'error_during_execution' | 'error_max_budget_usd' | 'error_max_structured_output_retries';
    errors?: string[];
    totalCost?: number;
    numTurns?: number;
  }

  const errorConfig = {
    error_max_turns: {
      icon: RotateCcw,
      title: 'Turn Limit Reached',
      description: 'The session reached its maximum number of turns.',
      action: 'Start new session or increase turn limit',
    },
    error_max_budget_usd: {
      icon: DollarSign,
      title: 'Budget Exceeded',
      description: 'The session exceeded its cost budget.',
      action: 'Increase budget in settings',
    },
    error_during_execution: {
      icon: AlertTriangle,
      title: 'Execution Error',
      description: 'An error occurred during tool execution.',
      action: 'Review the error and try again',
    },
    error_max_structured_output_retries: {
      icon: Settings,
      title: 'Output Validation Failed',
      description: 'Structured output could not be validated after retries.',
      action: 'Check output schema requirements',
    },
  };
</script>
```

### Files to Create
- `apps/dashboard/src/lib/components/features/message-renderers/ResultError.svelte`

### Files to Modify
- `apps/dashboard/src/lib/stores/realtime.svelte.ts` - Parse result message subtypes
- `apps/dashboard/src/lib/components/features/message-renderers/registry.ts` - Register error renderer
- Add `metadata.resultError` and `metadata.resultSubtype` to Message type

### UX Design
- Error card with colored border (red/orange based on severity)
- Icon + title + description
- Expandable "Details" for raw error messages
- Action button if applicable (e.g., "Open Settings")
## Acceptance

- [ ] ResultError component handles all 4 error subtypes
- [ ] Each subtype shows appropriate icon, title, description
- [ ] Error details expandable if present
- [ ] Styled as error card (distinct from regular messages)
- [ ] Result messages with error subtypes routed to this renderer
- [ ] Cost and turn count displayed when relevant
- [ ] Works in both light and dark themes
## Done summary
## Done Summary

- Created ResultError.svelte component with error-subtype-specific UI
- Handles 4 error subtypes: error_max_turns, error_during_execution, error_max_budget_usd, error_max_structured_output_retries
- Each subtype has custom icon, color scheme, title, description, and action suggestion
- Shows cost and turn count when available
- Expandable error details section for multiple errors
- Added 'result_error' message type
- Added result error metadata fields (resultSubtype, resultErrors, totalCost, numTurns)
- Updated SSE handler to parse result messages with error subtypes
- Registered ResultError in renderer registry (priority 85)
- Exported from message-renderers index

### Why
- Users see clear, actionable error messages instead of generic errors
- Specific recovery suggestions help users resolve issues
- Consistent error UX improves user experience

### Verification
- `bun run build` succeeds with no TypeScript errors
- ResultError renders with appropriate styling for each error subtype
## Evidence
- Commits:
- Tests: bun run build
- PRs: