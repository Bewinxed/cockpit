import {
  browseMdns,
  firstToAnswer,
  MDNS_BROWSE_MS,
  probeHub,
  tailscaleCandidates,
  toHttpBase,
  toWsUrl,
} from '@cockpit/agent';
import { COCKPIT_ENV, COCKPIT_HUB_PORT, COCKPIT_MDNS_TYPE } from '@cockpit/core';
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

/**
 * Finds the hub, trying the rungs in order and stopping at the first that
 * answers. Every rung narrates itself through `log`, because the answer to "why
 * did it pick that one" has to be readable without a debugger.
 *
 * The mDNS browse, the tailscale walk, and the probe itself live in
 * `@cockpit/agent`'s `discovery` module — they are shared with the daemon's
 * own re-discovery on a sustained reconnect failure. This file keeps only the
 * rungs that are specific to a `cockpit up`: being told outright, the CLI's
 * cached config, and localhost.
 */
export const discoverHub = async ({ hub, log }: DiscoverOptions = {}): Promise<Hub | undefined> => {
  const note = log ?? ((): void => {});
  const port = Number(process.env[COCKPIT_ENV.hubPort] ?? COCKPIT_HUB_PORT);

  const settle = async (httpUrl: string, source: HubSource): Promise<Hub> => {
    await writeConfig({ hubUrl: httpUrl });
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
  // A config written by `login` before any hub was known has an empty one.
  const cached = await readConfig();
  if (cached?.hubUrl) {
    note(`[2/5] cached ${cached.hubUrl} (${CONFIG_PATH}): probing`);
    if (await probeHub(cached.hubUrl)) {
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
  if (await probeHub(local)) {
    note(`[5/5] localhost answered`);
    return settle(local, 'localhost');
  }
  note(`[5/5] localhost did not answer`);

  return undefined;
};
