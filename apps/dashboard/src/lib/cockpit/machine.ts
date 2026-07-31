/** How a machine names itself vs. how the rail should say it out loud. */
import { IconLaptop, IconMonitor, IconServer, IconWindow } from '$lib/icons';

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
 */
export function machineOs(os: string) {
  const [platform = '', arch = ''] = os.trim().toLowerCase().split('-');

  switch (platform) {
    case 'darwin':
      return { label: 'macOS', arch, Icon: IconLaptop };
    case 'linux':
      return { label: 'Linux', arch, Icon: IconMonitor };
    case 'win32':
    case 'windows':
      return { label: 'Windows', arch, Icon: IconWindow };
    default:
      return { label: 'Unknown', arch, Icon: IconServer };
  }
}
