import { existsSync } from 'node:fs';
import { COCKPIT_ENV, COCKPIT_HUB_PORT, COCKPIT_MDNS_TYPE } from '@cockpit/core';
import { Bonjour, type Service } from 'bonjour-service';
import { CONFIG_PATH, readConfig, writeConfig } from './config';

/** Which rung of the ladder answered. */
export type HubSource = 'flag' | 'env' | 'config' | 'mdns' | 'tailscale' | 'localhost';

export interface Hub {
  /** `http://host:port` — the REST API's base. */
  httpUrl: string;
  /** `ws://host:port/ws` — what the daemon attaches to. */
  wsUrl: string;
  source: HubSource;
}

export interface DiscoverOptions {
  /** `--hub`, which outranks every other rung. */
  hub?: string;
  /** Where `--verbose` narration goes. Silent when absent. */
  log?: (line: string) => void;
}

/** Long enough for a responder on the link to answer, short enough to not feel stuck. */
const MDNS_BROWSE_MS = 2000;
const PROBE_TIMEOUT_MS = 1500;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Accepts either end of the pair — the daemon's `ws://host:port/ws`, a plain
 * http base, or a bare `host:port` — and answers with the http base.
 */
const toHttpBase = (raw: string): string | undefined => {
  const text = raw.trim();
  const url = URL.parse(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`);
  if (!url) return undefined;
  const scheme = { 'ws:': 'http:', 'wss:': 'https:' }[url.protocol] ?? url.protocol;
  return scheme === 'http:' || scheme === 'https:' ? `${scheme}//${url.host}` : undefined;
};

const toWsUrl = (httpBase: string): string => `${httpBase.replace(/^http/, 'ws')}/ws`;

/**
 * What tells a cockpit hub apart from whatever else is listening on the port:
 * `/api/agents` is the fleet, so a 200 carrying an array is the whole test.
 */
const probe = async (httpUrl: string): Promise<boolean> => {
  try {
    const response = await fetch(`${httpUrl}/api/agents`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return response.ok && Array.isArray(await response.json());
  } catch {
    return false;
  }
};

/** Probes every candidate at once and takes whichever answers first. */
const firstToAnswer = async (candidates: string[]): Promise<string | undefined> => {
  if (candidates.length === 0) return undefined;
  return Promise.any(
    candidates.map(async (url) => {
      if (!(await probe(url))) throw new Error(url);
      return url;
    })
  ).catch(() => undefined);
};

/**
 * Browses `_cockpit._tcp.local` for as long as it takes the first hub to answer.
 *
 * This is link-local multicast. It does not cross a router and it does not cross
 * a tailnet — a hub reachable only over Tailscale is invisible here no matter
 * how long the browse runs. That case belongs to {@link tailscaleCandidates};
 * do not come back and try to widen this one.
 */
const browseMdns = (): Promise<string[]> =>
  new Promise((resolve) => {
    const bonjour = new Bonjour();
    const settle = (candidates: string[]): void => {
      clearTimeout(timer);
      browser.stop();
      bonjour.destroy();
      resolve(candidates);
    };
    const browser = bonjour.find({ type: COCKPIT_MDNS_TYPE, protocol: 'tcp' }, (service: Service) => {
      const addresses = (service.addresses ?? []).filter((address) => IPV4.test(address));
      if (addresses.length > 0) settle(addresses.map((address) => `http://${address}:${service.port}`));
    });
    const timer = setTimeout(() => settle([]), MDNS_BROWSE_MS);
  });

/** The shape of `tailscale status --json` this reads, and nothing more. */
interface TailscaleNode {
  Online?: boolean;
  HostName?: string;
  TailscaleIPs?: string[];
}

/**
 * Every online node on the tailnet, at the hub port.
 *
 * This is the rung that actually crosses machines: mDNS is link-local, so a hub
 * in another building or another country is only ever found here. `Self` is in
 * the list alongside the peers because a hub can be bound to its tailnet address
 * alone, which no localhost probe would reach.
 */
/**
 * The macOS app ships its CLI inside the bundle and only symlinks it into the
 * PATH if the user asks, so a Mac on the tailnet reads as "no tailscale" unless
 * these are tried — found the hard way, from a Mac that was plainly on the net.
 */
const TAILSCALE_BINARIES = [
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  '/usr/local/bin/tailscale',
  '/opt/homebrew/bin/tailscale',
];

const tailscaleBinary = (): string | undefined =>
  Bun.which('tailscale') ?? TAILSCALE_BINARIES.find((path) => existsSync(path));

const tailscaleCandidates = async (port: number): Promise<{ ip: string; host: string }[]> => {
  const binary = tailscaleBinary();
  if (!binary) return [];
  const status = await Bun.$`${binary} status --json`
    .quiet()
    .json()
    .catch(() => undefined);
  if (!status) return [];

  const nodes: TailscaleNode[] = [
    ...Object.values((status.Peer ?? {}) as Record<string, TailscaleNode>),
    ...((status.Self ? [status.Self] : []) as TailscaleNode[]),
  ];
  return nodes
    .filter((node) => node.Online && node.TailscaleIPs?.[0])
    .map((node) => ({ ip: `http://${node.TailscaleIPs?.[0]}:${port}`, host: node.HostName ?? '?' }));
};

/**
 * Finds the hub, trying the rungs in order and stopping at the first that
 * answers. Every rung narrates itself through `log`, because the answer to "why
 * did it pick that one" has to be readable without a debugger.
 */
export const discoverHub = async ({ hub, log }: DiscoverOptions = {}): Promise<Hub | undefined> => {
  const note = log ?? ((): void => {});
  const port = Number(process.env[COCKPIT_ENV.hubPort] ?? COCKPIT_HUB_PORT);

  const settle = async (httpUrl: string, source: HubSource): Promise<Hub> => {
    await writeConfig(httpUrl);
    return { httpUrl, wsUrl: toWsUrl(httpUrl), source };
  };

  // 1. Being told outranks being clever, and an explicit hub is not probed: the
  //    daemon is allowed to start before the hub it was pointed at exists.
  const explicit = hub ?? process.env[COCKPIT_ENV.hubUrl];
  if (explicit) {
    const source = hub ? 'flag' : 'env';
    const base = toHttpBase(explicit);
    if (base) {
      note(`[1/5] ${source === 'flag' ? '--hub' : COCKPIT_ENV.hubUrl}: ${base}`);
      return settle(base, source);
    }
    note(`[1/5] ${source === 'flag' ? '--hub' : COCKPIT_ENV.hubUrl}: ${explicit} is not a URL`);
  } else {
    note(`[1/5] --hub / ${COCKPIT_ENV.hubUrl}: not set`);
  }

  // 2. The hub found last time is the hub most runs want, so it costs one probe.
  const cached = await readConfig();
  if (cached) {
    note(`[2/5] cached ${cached.hubUrl} (${CONFIG_PATH}): probing`);
    if (await probe(cached.hubUrl)) {
      note(`[2/5] cached hub answered`);
      return settle(cached.hubUrl, 'config');
    }
    note(`[2/5] cached hub did not answer`);
  } else {
    note(`[2/5] no cached hub at ${CONFIG_PATH}`);
  }

  // 3. Same network, nothing configured.
  note(`[3/5] mDNS _${COCKPIT_MDNS_TYPE}._tcp.local: browsing ${MDNS_BROWSE_MS}ms`);
  const advertised = await browseMdns();
  if (advertised.length > 0) {
    note(`[3/5] mDNS advertised ${advertised.join(', ')}: probing`);
    const answered = await firstToAnswer(advertised);
    if (answered) {
      note(`[3/5] ${answered} answered`);
      return settle(answered, 'mdns');
    }
    note(`[3/5] nothing advertised answered`);
  } else {
    note(`[3/5] nothing advertising on the local link`);
  }

  // 4. Different network — the tailnet is the only rung that gets there.
  const peers = await tailscaleCandidates(port);
  if (peers.length > 0) {
    note(`[4/5] tailscale: probing ${peers.map((p) => `${p.host} ${p.ip}`).join(', ')}`);
    const answered = await firstToAnswer(peers.map((peer) => peer.ip));
    if (answered) {
      note(`[4/5] ${answered} answered`);
      return settle(answered, 'tailscale');
    }
    note(`[4/5] no tailscale peer answered on :${port}`);
  } else {
    note(`[4/5] tailscale: no binary, or no online peers`);
  }

  // 5. The hub is on this machine, which is how most people start.
  const local = `http://localhost:${port}`;
  note(`[5/5] ${local}: probing`);
  if (await probe(local)) {
    note(`[5/5] localhost answered`);
    return settle(local, 'localhost');
  }
  note(`[5/5] localhost did not answer`);

  return undefined;
};
