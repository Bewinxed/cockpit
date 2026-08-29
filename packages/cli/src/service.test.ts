import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SERVICE_IDS,
  isServiceId,
  liveOrphans,
  parseProcStartTicks,
  readSessiondLedger,
  restartDecision,
  serviceDefinition,
  sessiondLedgerPath,
  sweepSessiondOrphans,
  writeSessiondLedger,
  type LedgerEntry,
} from './service';

/**
 * These tests read generated unit and plist text. Nothing here installs,
 * enables, starts or restarts anything: no `systemctl`, no `launchctl`, and the
 * only filesystem writes go to a scratch directory this file makes and removes.
 */

describe('sessiond joins the service set', () => {
  test('it is a service id, ordered before the agent that dials it', () => {
    expect(isServiceId('sessiond')).toBe(true);
    expect([...SERVICE_IDS]).toEqual(['hub', 'dashboard', 'sessiond', 'agent']);
    expect(SERVICE_IDS.indexOf('sessiond')).toBeLessThan(SERVICE_IDS.indexOf('agent'));
  });

  test('the systemd unit carries the design §11 supervision settings', () => {
    const text = serviceDefinition('sessiond', 'prod', 'systemd');
    expect(text).toContain('Description=Cockpit sessiond');
    expect(text).toContain('StartLimitIntervalSec=0');
    expect(text).toContain('Restart=on-failure');
    expect(text).toContain('RestartSec=2');
    expect(text).toContain('WantedBy=default.target');
    expect(text).toContain('packages/sessiond/src/main.ts');
  });

  /**
   * The counter-intuitive one, and the reason it is asserted rather than
   * commented: sessiond's children must die with it (design §11), which is
   * systemd's default `KillMode=control-group`. The unit says so by saying
   * nothing, and a future `KillMode=process` added "to be safe" would be
   * exactly the trap — so the absence is pinned.
   */
  test('no unit sets KillMode — the cgroup default is the decision', () => {
    for (const id of SERVICE_IDS) {
      expect(serviceDefinition(id, 'prod', 'systemd')).not.toContain('KillMode');
    }
  });

  test('sessiond orders after nothing — it is the one service that comes up alone', () => {
    const text = serviceDefinition('sessiond', 'prod', 'systemd');
    expect(text).not.toContain('After=');
    expect(text).not.toContain('Wants=');
  });

  test('the launchd plist is well-formed and names the same entry point', () => {
    const text = serviceDefinition('sessiond', 'prod', 'launchd');
    expect(text).toContain('<key>Label</key>\n  <string>dev.cockpit.sessiond</string>');
    expect(text).toContain('packages/sessiond/src/main.ts');
    // `restartOnSuccess: false` — a drained sessiond exited because it was told to.
    expect(text).toContain('<key>SuccessfulExit</key>');
    expect(text.trimEnd().endsWith('</plist>')).toBe(true);
  });
});

describe('the agent orders after sessiond', () => {
  test('systemd: quoted from the generated unit', () => {
    const text = serviceDefinition('agent', 'prod', 'systemd');
    const ordering = text
      .split('\n')
      .filter(
        (line) =>
          line.startsWith('Requires=') || line.startsWith('Wants=') || line.startsWith('After=')
      );
    // The two dependencies are deliberately different strengths. The hub is
    // soft — the daemon reconnects with backoff and works through an outage.
    // sessiond is hard: it is the only spawn path, so an agent without it is up
    // and unable to start a single session. `Requires=` makes that fail once,
    // loudly, rather than once per spawn.
    expect(ordering).toEqual([
      'Requires=cockpit-sessiond.service',
      'Wants=cockpit-hub.service',
      'After=cockpit-hub.service',
      'After=cockpit-sessiond.service',
    ]);
  });

  test('the hub stays soft — losing it must not take the agent down', () => {
    const text = serviceDefinition('agent', 'prod', 'systemd');
    expect(text).toContain('Wants=cockpit-hub.service');
    expect(text).not.toContain('Requires=cockpit-hub.service');
  });

  test('launchd: recorded in the plist, since launchd has no ordering to enforce', () => {
    const text = serviceDefinition('agent', 'prod', 'launchd');
    expect(text).toContain(
      '<!-- ordering: starts after dev.cockpit.hub, dev.cockpit.sessiond — launchd has no ordering, so this is recorded, not enforced -->'
    );
  });

  test('a service with no sibling ordering gets no comment', () => {
    // The hub's only `After=` is `network-online.target`, which launchd has no
    // counterpart for and so has nothing to say about.
    expect(serviceDefinition('hub', 'prod', 'launchd')).not.toContain('<!-- ordering');
    expect(serviceDefinition('sessiond', 'prod', 'launchd')).not.toContain('<!-- ordering');
  });
});

describe('restarting sessiond goes through the same gate as the agent', () => {
  test('busy refuses, and says what a sessiond restart costs', () => {
    const decision = restartDecision({ busy: 3, whenIdle: false, force: false, id: 'sessiond' });
    if (decision.kind !== 'refuse') throw new Error(`expected a refusal, got ${decision.kind}`);
    expect(decision.reason).toContain('the sessiond on this machine is mid-turn in 3 sessions');
    expect(decision.reason).toContain('kills the harness children in its cgroup');
    expect(decision.reason).toContain('--when-idle');
    expect(decision.reason).toContain('--force');
  });

  test('--when-idle waits instead of refusing', () => {
    expect(restartDecision({ busy: 2, whenIdle: true, force: false, id: 'sessiond' })).toEqual({
      kind: 'wait',
      busy: 2,
    });
  });

  test('--force goes, busy or unknown', () => {
    expect(restartDecision({ busy: 9, whenIdle: false, force: true, id: 'sessiond' })).toEqual({
      kind: 'go',
    });
    expect(
      restartDecision({ busy: 'unknown', whenIdle: false, force: true, id: 'sessiond' })
    ).toEqual({ kind: 'go' });
  });

  test('an unknown busy count is never read as idle', () => {
    const decision = restartDecision({
      busy: 'unknown',
      whenIdle: false,
      force: false,
      id: 'sessiond',
    });
    if (decision.kind !== 'refuse') throw new Error(`expected a refusal, got ${decision.kind}`);
    expect(decision.reason).toContain('restarting the sessiond blind');
  });

  test('idle goes', () => {
    expect(restartDecision({ busy: 0, whenIdle: false, force: false, id: 'sessiond' })).toEqual({
      kind: 'go',
    });
  });

  test('the agent wording is unchanged when no id is given', () => {
    const decision = restartDecision({ busy: 1, whenIdle: false, force: false });
    if (decision.kind !== 'refuse') throw new Error(`expected a refusal, got ${decision.kind}`);
    expect(decision.reason).toContain('the agent on this machine is mid-turn in 1 session');
    expect(decision.reason).toContain('a restart ends that work');
  });
});

describe('the ad-hoc pid ledger', () => {
  test('field 22 survives a comm with spaces and parentheses', () => {
    // Real shape of /proc/<pid>/stat (proc_pid_stat(5)): fields 1..3 are pid,
    // (comm), state; field 22 is starttime. Here fields 3.. are numbered so the
    // one that comes back is unambiguous.
    const fields = Array.from({ length: 50 }, (_, index) => `${index + 3}`);
    const stat = `4242 (my (weird) prog) ${fields.join(' ')}`;
    expect(parseProcStartTicks(stat)).toBe('22');
  });

  test('a line with no comm at all yields nothing rather than a wrong field', () => {
    expect(parseProcStartTicks('not a stat line')).toBeUndefined();
  });

  test('a recycled pid is not an orphan — the start time has to match too', async () => {
    const entries: LedgerEntry[] = [
      { pid: 111, startTicks: '900' },
      { pid: 222, startTicks: '901' },
      { pid: 333, startTicks: '902' },
    ];
    const markers = new Map([
      [111, '900'], // same process, still ours
      [222, '77777'], // pid handed back out to somebody else
      // 333 is simply gone
    ]);
    const alive = await liveOrphans(entries, async (pid) => markers.get(pid));
    expect(alive).toEqual([{ pid: 111, startTicks: '900' }]);
  });

  test('the ledger round-trips and rejects malformed entries', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-ledger-'));
    const path = join(dir, 'sessiond-children.json');
    try {
      expect(await readSessiondLedger(path)).toEqual([]); // no file yet
      await writeSessiondLedger([{ pid: 7, startTicks: '123' }], path);
      expect(await readSessiondLedger(path)).toEqual([{ pid: 7, startTicks: '123' }]);

      await Bun.write(path, JSON.stringify([{ pid: 'seven' }, 3, { pid: 8, startTicks: '4' }]));
      expect(await readSessiondLedger(path)).toEqual([{ pid: 8, startTicks: '4' }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a sweep whose entries all fail the start-time match kills nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-ledger-'));
    const path = join(dir, 'sessiond-children.json');
    try {
      // pid 1 exists on every machine this file supports, and this start time is
      // categorically not its own — so the sweep must leave init alone.
      await writeSessiondLedger([{ pid: 1, startTicks: 'not-init-start-time' }], path);
      const notes: string[] = [];
      const killed = await sweepSessiondOrphans((line) => notes.push(line), path);
      expect(killed).toEqual([]);
      expect(notes).toEqual([]);
      // Whatever the ledger claimed has now been answered.
      expect(await Bun.file(path).exists()).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an empty ledger is a no-op', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-ledger-'));
    try {
      expect(await sweepSessiondOrphans(() => {}, join(dir, 'missing.json'))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the ledger sits beside the socket it describes', () => {
    expect(sessiondLedgerPath().endsWith('/sessiond-children.json')).toBe(true);
  });
});
