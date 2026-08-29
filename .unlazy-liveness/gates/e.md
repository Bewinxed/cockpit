# Gates: E — close

Scope: verification only; the smallest fixes it uncovers may touch any file with the chair
notified in the report.

- [ ] G1: every suite green, counts quoted (dashboard ≥266, hub ≥84, agent ≥124, sessiond, cli)
  CHECK: cd /home/bewinxed/cockpit && bun test apps/dashboard/src/lib/cockpit/ packages/hub/ packages/agent/ packages/sessiond/ packages/cli/ 2>&1 | grep -E "[0-9]+ (pass|fail)" | tail -4
  EXPECT: 0 fail
  EVIDENCE: pending

- [ ] G2: every package typecheck exits 0 (agent included — A1 fixed the pre-existing error)
  CHECK: cd /home/bewinxed/cockpit && bun run typecheck 2>&1 | grep -c "Exited with code 0"
  EXPECT: /^[5-9]/
  EVIDENCE: pending (quote the actual workspace count)

- [ ] G3: security pass (Opus) on the deploy/update surface, written up: the poller executes code from origin/main by design — verify the pull is ff-only against a pinned https origin, no other remote or branch is reachable from poller input, only register-authenticated agent sockets can be told to update, unit files leak no secrets into the clone, and the tailnet-only posture is stated in ARCHITECTURE.md
  EVIDENCE: pending

- [ ] G4: every leaf's gates file re-run via gate-check; any ABANDON lines itemized in the final report
  EVIDENCE: pending

- [ ] G5: final report enumerates the operator's original asks (session truth, the split verdict, tmux-for-sessions, auto-update-on-push, cross-machine, re-discovery) each with one line of evidence
  EVIDENCE: pending

=====================================================================
End of executor spec.
=====================================================================
