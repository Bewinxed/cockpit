import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Tailscale status response structure
 */
export interface TailscaleStatus {
  /** Version of Tailscale */
  Version: string;
  /** Whether the tailnet is using MagicDNS */
  MagicDNSEnabled: boolean;
  /** Current device info */
  Self: TailscalePeer;
  /** Map of peer device IDs to peer info */
  Peer: Record<string, TailscalePeer>;
  /** Current tailnet name */
  CurrentTailnet?: {
    Name: string;
    MagicDNSSuffix: string;
  };
}

/**
 * Tailscale peer (self or remote device)
 */
export interface TailscalePeer {
  /** Tailscale ID */
  ID: string;
  /** Public key */
  PublicKey: string;
  /** Hostname */
  HostName: string;
  /** DNS name in the tailnet */
  DNSName: string;
  /** Operating system */
  OS: string;
  /** Tailscale IP addresses (usually IPv4 and IPv6) */
  TailscaleIPs: string[];
  /** Whether the peer is currently online */
  Online: boolean;
  /** Whether this is the current device */
  Self?: boolean;
  /** Last time the peer was seen */
  LastSeen?: string;
  /** Whether the peer is actively connected */
  Active?: boolean;
}

/**
 * Simplified peer info for discovery
 */
export interface TailscalePeerInfo {
  /** Peer hostname */
  hostname: string;
  /** Peer's Tailscale IPv4 address */
  ip: string;
  /** Operating system */
  os: string;
  /** Whether the peer is currently online */
  online: boolean;
  /** DNS name */
  dnsName: string;
}

/**
 * Get the full Tailscale status JSON
 * @returns Tailscale status object or null if Tailscale is not running
 */
export async function getTailscaleStatus(): Promise<TailscaleStatus | null> {
  try {
    const { stdout } = await execAsync('tailscale status --json');
    return JSON.parse(stdout) as TailscaleStatus;
  } catch (error) {
    console.error('Failed to get Tailscale status:', error);
    return null;
  }
}

/**
 * Get this machine's Tailscale IPv4 address
 * @returns The IPv4 address or null if not available
 */
export async function getTailscaleIp(): Promise<string | null> {
  try {
    const status = await getTailscaleStatus();
    if (!status?.Self?.TailscaleIPs) {
      return null;
    }

    // Find the IPv4 address (not IPv6)
    const ipv4 = status.Self.TailscaleIPs.find((ip) => !ip.includes(':'));
    return ipv4 || null;
  } catch (error) {
    console.error('Failed to get Tailscale IP:', error);
    return null;
  }
}

/**
 * Get this machine's Tailscale hostname
 * @returns The hostname or null if not available
 */
export async function getTailscaleHostname(): Promise<string | null> {
  try {
    const status = await getTailscaleStatus();
    return status?.Self?.HostName || null;
  } catch (error) {
    console.error('Failed to get Tailscale hostname:', error);
    return null;
  }
}

/**
 * Get list of online peers with their Tailscale IPs
 * @returns Array of peer info objects
 */
export async function getOnlinePeers(): Promise<TailscalePeerInfo[]> {
  try {
    const status = await getTailscaleStatus();
    if (!status?.Peer) {
      return [];
    }

    const peers: TailscalePeerInfo[] = [];

    for (const peer of Object.values(status.Peer)) {
      if (!peer.Online) {
        continue;
      }

      const ipv4 = peer.TailscaleIPs?.find((ip) => !ip.includes(':'));
      if (!ipv4) {
        continue;
      }

      peers.push({
        hostname: peer.HostName,
        ip: ipv4,
        os: peer.OS,
        online: peer.Online,
        dnsName: peer.DNSName,
      });
    }

    return peers;
  } catch (error) {
    console.error('Failed to get online peers:', error);
    return [];
  }
}

/**
 * Get all peers (online and offline)
 * @returns Array of peer info objects
 */
export async function getAllPeers(): Promise<TailscalePeerInfo[]> {
  try {
    const status = await getTailscaleStatus();
    if (!status?.Peer) {
      return [];
    }

    const peers: TailscalePeerInfo[] = [];

    for (const peer of Object.values(status.Peer)) {
      const ipv4 = peer.TailscaleIPs?.find((ip) => !ip.includes(':'));
      if (!ipv4) {
        continue;
      }

      peers.push({
        hostname: peer.HostName,
        ip: ipv4,
        os: peer.OS,
        online: peer.Online,
        dnsName: peer.DNSName,
      });
    }

    return peers;
  } catch (error) {
    console.error('Failed to get peers:', error);
    return [];
  }
}

/**
 * Check if Tailscale is installed and running
 * @returns True if Tailscale is available
 */
export async function isTailscaleAvailable(): Promise<boolean> {
  try {
    await execAsync('tailscale version');
    const status = await getTailscaleStatus();
    return status !== null;
  } catch {
    return false;
  }
}

/**
 * Get the current tailnet name
 * @returns The tailnet name or null if not available
 */
export async function getTailnetName(): Promise<string | null> {
  try {
    const status = await getTailscaleStatus();
    return status?.CurrentTailnet?.Name || null;
  } catch {
    return null;
  }
}
