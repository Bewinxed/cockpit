# fn-4.6 Verify Interactive Messages Work in Tabs

## Description

Verify all interactive message types work correctly in the tab-based WorkspaceInstance system.

### Context
The dashboard was rewritten to use a tab-based workspace. Need to verify that all interactive message functionality from commit `78a93e9` works correctly:
- Login flow (`/login` command)
- Model picker (`/model` command)
- Memory editor (`/memory` command)
- Help menu (`/help` command)
- Message editing (edit + rewind)
- Permission requests

### Verification Checklist

1. **Login Flow**
   - `/login` shows OAuth prompt
   - Auth URL opens in new tab
   - Code paste completes authentication
   - Cancel works correctly
   - Error states handled

2. **Model Picker**
   - `/model` fetches and displays available models
   - Current model highlighted
   - Keyboard navigation (arrow keys)
   - Selection changes model
   - Cancel works

3. **Memory Editor**
   - `/memory` shows project/user selection
   - Selection loads memory content
   - Editor allows modification
   - Save persists changes
   - Cancel works

4. **Help Menu**
   - `/help` shows available commands
   - Commands fetched from server
   - Styled correctly

5. **Message Editing**
   - Edit button appears on user messages
   - Edit mode shows textarea with content
   - Submit creates forked session
   - Cancel restores original

6. **Permission Requests**
   - Requests appear above input
   - Allow/Deny buttons work
   - Suggestions shown if provided

### Files to Review
- `apps/dashboard/src/lib/components/workspace/WorkspaceInstance.svelte:365-504` - Command handling
- `apps/dashboard/src/lib/components/workspace/WorkspaceInstance.svelte:506-641` - Interactive handlers
- `apps/dashboard/src/lib/components/features/ChatMessage.svelte:602-1012` - Interactive renderers

### Test Process
1. Start dev server: `bun run dev:dashboard`
2. Create new instance
3. Test each interactive flow
4. Document any issues found
5. Fix issues if scope allows, or create new tasks
## Acceptance

- [ ] `/login` flow works end-to-end (OAuth start, code paste, success/error)
- [ ] `/model` picker displays models with keyboard navigation
- [ ] `/memory` editor loads, edits, and saves memory files
- [ ] `/help` shows commands list with descriptions
- [ ] User message edit + rewind functionality works
- [ ] Permission requests display and allow/deny works
- [ ] `/clear` clears messages correctly
- [ ] All interactive states tracked correctly when switching tabs
- [ ] No console errors during interactive flows
- [ ] Keyboard shortcuts work (Enter to submit, Escape to cancel)
## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
