Cockpit - Feature Checklist

  Core Architecture

  - Hub Server - Central coordination server
  - Agent Service - Daemon running on machines with Claude Code
  - Dashboard - Web UI for management

  Agent Management

  | Feature                                 | Status      | Issue                    |
  |-----------------------------------------|-------------|--------------------------|
  | Agent auto-discovers hub via mDNS       | ✅ Works    |                          |
  | Agent connects to hub via WebSocket     | ✅ Works    |                          |
  | Agent shows online/offline status       | ⚠️ Partial  | Shows stale status in UI |
  | Agent reconnects after hub restart      | ❓ Untested |                          |
  | Multiple agents from different machines | ❓ Untested |                          |

  Instance Lifecycle

  | Feature                                | Status      | Issue                                       |
  |----------------------------------------|-------------|---------------------------------------------|
  | Spawn instance on agent                | ⚠️ Partial  | Requires OAuth, errors show [object Object] |
  | Send message to running instance       | ❌ Broken   | Agent loses instances on restart            |
  | Stop instance                          | ⚠️ Partial  | Can't stop stale instances properly         |
  | View instance output/messages          | ❌ Broken   | No message history displayed                |
  | Resume instance in same directory      | ❌ Missing  | No way to wake up stale instances           |
  | Sync instance state on agent reconnect | ❌ Missing  | Orphaned instances stay "running"           |
  | Instance cost tracking                 | ❓ Untested |                                             |

  Real-time Updates (WebSocket)

  | Feature                         | Status      | Issue                              |
  |---------------------------------|-------------|------------------------------------|
  | Dashboard receives live updates | ⚠️ Partial  | Clients connect/disconnect rapidly |
  | Instance messages stream to UI  | ❌ Broken   | Messages not showing               |
  | Status changes broadcast        | ❓ Untested |                                    |

  Error Handling

  | Feature                     | Status     | Issue                             |
  |-----------------------------|------------|-----------------------------------|
  | Proper error messages in UI | ❌ Broken  | Shows [object Object]             |
  | Auth required errors        | ⚠️ Partial | Modal exists but error text wrong |

  Projects

  | Feature                          | Status      | Issue |
  |----------------------------------|-------------|-------|
  | Create project                   | ❓ Untested |       |
  | Associate instances with project | ❓ Untested |       |
  | Project-level settings           | ❓ Untested |       |

  ---
  What SHOULD Happen (User Flow)

  1. Start hub → Hub listens on port 3456, advertises via mDNS
  2. Start agent → Agent discovers hub, connects, registers
  3. Open dashboard → See online agents, existing instances
  4. Spawn instance → Pick agent, pick directory, instance starts
  5. Send messages → Type in chat, see Claude's responses stream back
  6. Agent restarts → Agent reconnects, resumes or marks orphaned instances
  7. Resume instance → Click on stopped/stale instance, respawn in same dir with history

  ---
  What's the priority? I'd suggest:
  1. Fix [object Object] error display (need console output to debug)
  2. Fix instance sync on agent reconnect (mark orphaned as stopped)
  3. Add "Resume in same directory" feature
  4. Fix message streaming to UI

  Todos
  ☐ Fix [object Object] display in UI for errors