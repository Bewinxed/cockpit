# fn-4.5 Add MCP Server Status Display

## Description

Display MCP server status from the SDK system init message.

### Context
SDK `SystemMessage` with `subtype: 'init'` includes:
```typescript
mcp_servers: {
  name: string;
  status: string; // 'connected', 'error', 'needs-auth'
}[]
```

Currently this data is received but not displayed to users.

### Target State
- Init message shows MCP server status
- Each server shows name + status with appropriate icon/color
- Errors/needs-auth highlighted for user attention

### Implementation Details

Update the system init message rendering to include MCP status:

```svelte
<!-- In system message rendering -->
{#if message.metadata?.subtype === 'init' && message.metadata?.mcpServers}
  <div class="mcp-status mt-2 text-xs">
    <span class="font-medium text-muted-foreground">MCP Servers:</span>
    <div class="flex flex-wrap gap-2 mt-1">
      {#each message.metadata.mcpServers as server}
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
          class:bg-success/10={server.status === 'connected'}
          class:text-success={server.status === 'connected'}
          class:bg-warning/10={server.status === 'needs-auth'}
          class:text-warning={server.status === 'needs-auth'}
          class:bg-error/10={server.status === 'error'}
          class:text-error={server.status === 'error'}
        >
          <Circle class="size-2 fill-current" />
          {server.name}
        </span>
      {/each}
    </div>
  </div>
{/if}
```

### Files to Modify
- `apps/dashboard/src/lib/stores/realtime.svelte.ts` - Parse `mcp_servers` from init message
- `apps/dashboard/src/lib/stores/realtime.svelte.ts:53-103` - Add `mcpServers` to Message metadata type
- `apps/dashboard/src/lib/components/features/ChatMessage.svelte` - Render MCP status in system messages

### UX Design
- Compact pill/badge format for each server
- Green for connected, yellow for needs-auth, red for error
- Tooltip with full status details on hover (optional)
## Acceptance

- [ ] `mcp_servers` parsed from init message and stored in metadata
- [ ] MCP status displayed in system init message UI
- [ ] Status badges color-coded (connected=green, needs-auth=yellow, error=red)
- [ ] Server names clearly visible
- [ ] Graceful handling when no MCP servers present
- [ ] Doesn't clutter UI when many servers (consider collapsible if >5)
## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
