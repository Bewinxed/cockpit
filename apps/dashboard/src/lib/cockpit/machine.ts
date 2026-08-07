/** How a machine names itself vs. how the rail should say it out loud. */
import type { AgentRow } from '@cockpit/core';
import { IconLaptopDuo, IconMonitorDuo, IconServerDuo, IconWindowDuo } from '$lib/icons';

/** mDNS and router suffixes: they say "same network", which the rail already implies. */
const LOCAL_SUFFIXES = ['.local', '.lan', '.home'];

export function machineLabel(hostname: string): string {
  const name = hostname.trim();
  const suffix = LOCAL_SUFFIXES.find((s) => name.toLowerCase().endsWith(s));
  return suffix ? name.slice(0, -suffix.length) : name;
}

/**
 * Splits the daemon's `platform-arch` fingerprint into something readable.
 * The platform is Node's `process.platform`, so it is a fixed vocabulary.
 * The glyph is duotone because it says what the box is, not what to do with it.
 */
export function machineOs(os: string) {
  const [platform = '', arch = ''] = os.trim().toLowerCase().split('-');

  switch (platform) {
    case 'darwin':
      return { label: 'macOS', arch, Icon: IconLaptopDuo };
    case 'linux':
      return { label: 'Linux', arch, Icon: IconMonitorDuo };
    case 'win32':
    case 'windows':
      return { label: 'Windows', arch, Icon: IconWindowDuo };
    default:
      return { label: 'Unknown', arch, Icon: IconServerDuo };
  }
}

/**
 * Why a machine cannot start a session, in the words the person looking at the
 * rail needs — which is the remedy, on which machine, and for the macOS case why
 * signing in again is not it. Undefined when there is nothing to say.
 */
export function signInWarning(machine: AgentRow): string | undefined {
  switch (machine.auth) {
    case 'unreadable-credentials':
      return `${machineLabel(machine.hostname)} has Claude Code credentials it cannot read: they are in the login keychain, and its agent is running outside the desktop session. Signing in again will not help. On that machine, run \`cockpit service install\` — a LaunchAgent can read the keychain — or \`cockpit login\` for a token.`;
    case 'unauthenticated':
      return `Nobody is signed in to Claude Code on ${machineLabel(machine.hostname)}, so sessions there will answer "Not logged in". Run \`cockpit login\` on that machine.`;
    default:
      return undefined;
  }
}
