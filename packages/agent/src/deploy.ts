/**
 * The deployment channel (PLAN.md contract C8): every machine's services run out
 * of a dedicated clean clone that tracks `origin/main`, and this daemon watches
 * that clone for new commits.
 *
 * The problem it exists for, measured rather than imagined: the services on this
 * fleet have been running straight out of a dev working tree that many agent
 * sessions edit at once, so a restart deploys whatever was half-written at that
 * second, and {@link import('./update').updateCheckout} rightly refuses a dirty
 * checkout — which means the machine could never catch itself up. Meanwhile the
 * Mac's daemon ran for 21 days without ever learning that main had moved,
 * because nothing looked.
 *
 * The guard is the marker. A checkout with no `.whiffle-deploy` in it is not a
 * deployment clone, and this module will not so much as *fetch* in one, let
 * alone pull. That is deliberately the first thing every path here checks: a dev
 * tree must be structurally unable to auto-pull, and "we remembered to check"
 * is not a structure.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { DeployInfo } from "@whiffle/core";
import { readEnv, WHIFFLE_ENV } from "@whiffle/core";

/**
 * The marker file, relative to the clone's root. Its presence — and nothing
 * else — is what licenses an automatic pull.
 */
export const DEPLOY_MARKER = ".whiffle-deploy";

/**
 * Where a machine's deployment clone lives. Our choice: per-user so it needs no
 * sudo, under a dotdir so it is nobody's working copy, and deliberately outside
 * every dev checkout so `git clean -fdx` in one cannot reach it.
 *
 * `WHIFFLE_DEPLOY_ROOT` overrides it — that is how the tests point at a scratch
 * directory, and how a machine with a different home layout is accommodated.
 */
export const deployRoot = (): string =>
  readEnv(WHIFFLE_ENV.deployRoot) ?? join(homedir(), ".whiffle", "app");

/** The branch a deployment clone follows. Push to it and the fleet deploys. */
export const DEPLOY_BRANCH = "main";

/**
 * How often the daemon asks whether main has moved. Our choice, 60 s: a fetch
 * of one branch is a few KiB and costs the remote nothing at fleet scale, and a
 * minute is under the time it takes an operator to walk to the machine and
 * wonder why it has not picked the push up.
 */
export const DEPLOY_POLL_MS = 60_000;

/** What `whiffle deploy init` wrote, read back. */
export interface DeployMarker {
  /** The branch it tracks — {@link DEPLOY_BRANCH}. */
  readonly branch: string;
  /** ISO 8601, when init ran. */
  readonly createdAt: string;
  /** What wrote it, so a person finding the file knows what to ask. */
  readonly createdBy: string;
  /** The remote it was cloned from. */
  readonly origin: string;
  /** The clone's root, as init resolved it. */
  readonly root: string;
}

export const markerPath = (root: string): string => join(root, DEPLOY_MARKER);

/**
 * The marker, or nothing. A file that is there but unreadable, or that does not
 * carry the fields init writes, is treated as no marker at all: the guard fails
 * closed, because the failure it is guarding against is pulling into somebody's
 * unfinished work.
 */
export const readDeployMarker = async (
  root: string = deployRoot()
): Promise<DeployMarker | undefined> => {
  const parsed = (await Bun.file(markerPath(root))
    .json()
    .catch(() => undefined)) as Partial<DeployMarker> | undefined;
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }
  const { root: markedRoot, origin, branch, createdAt, createdBy } = parsed;
  if (
    typeof markedRoot !== "string" ||
    typeof origin !== "string" ||
    typeof branch !== "string" ||
    typeof createdAt !== "string" ||
    typeof createdBy !== "string"
  ) {
    return undefined;
  }
  return { root: markedRoot, origin, branch, createdAt, createdBy };
};

export const isDeployClone = async (
  root: string = deployRoot()
): Promise<boolean> => (await readDeployMarker(root)) !== undefined;

/**
 * Where a checkout stands against the branch it deploys from. Every kind but
 * `behind` means *do not pull*, and each says why in terms someone reading the
 * board can act on.
 */
export type DeployState =
  /** No marker: this is somebody's working tree, and nothing here touches it. */
  | { readonly kind: "unmarked"; readonly root: string }
  /** The marker is there but the checkout is not usable — no git, no remote. */
  | {
      readonly kind: "unreachable";
      readonly root: string;
      readonly reason: string;
    }
  /** Level with the branch. Nothing to do, and that is the normal answer. */
  | { readonly kind: "current"; readonly root: string; readonly head: string }
  /** New commits upstream and none of our own: the one state that deploys. */
  | {
      readonly kind: "behind";
      readonly root: string;
      readonly head: string;
      readonly target: string;
      readonly behind: number;
    }
  /**
   * Commits here that the branch does not have. Nothing to pull, so nothing
   * fails — but it is reported, because a deployment clone growing local
   * commits is somebody having debugged on the wrong machine.
   */
  | {
      readonly kind: "ahead";
      readonly root: string;
      readonly head: string;
      readonly target: string;
      readonly ahead: number;
    }
  /**
   * Both sides moved. This is the refusal the contract is most insistent
   * about: never reset, never force-pull, never rebase. Losing an operator's
   * divergence silently is worse than not deploying, so the clone stays exactly
   * as it is and the skew is surfaced until a person resolves it.
   */
  | {
      readonly kind: "diverged";
      readonly root: string;
      readonly head: string;
      readonly target: string;
      readonly ahead: number;
      readonly behind: number;
    };

/** One command's outcome, in the shape the checks below want to read it. */
interface Ran {
  readonly err: string;
  readonly ok: boolean;
  readonly out: string;
}

/** How long a git call gets before it has plainly hung — a fetch to a dead remote. */
const GIT_TIMEOUT_MS = 60_000;
const WHITESPACE = /\s+/;

export type GitRunner = (root: string, args: readonly string[]) => Promise<Ran>;

const runGit: GitRunner = async (root, args) => {
  const child = Bun.spawn(["git", "-C", root, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: GIT_TIMEOUT_MS,
  });
  const [out, err] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const code = await child.exited;
  if (child.signalCode) {
    return {
      ok: false,
      out: "",
      err: `git ${args[0]} timed out after ${GIT_TIMEOUT_MS / 1000}s`,
    };
  }
  return { ok: code === 0, out: out.trim(), err: err.trim() };
};

export interface DeployCheckOptions {
  /** Injected by the tests, which drive a bare repo in a scratch directory. */
  readonly git?: GitRunner;
  readonly root?: string;
}

/**
 * `git rev-list --left-right --count HEAD...origin/main` prints "ahead\tbehind"
 * — the two-sided question in one call, which is what tells `behind` (safe to
 * fast-forward) apart from `diverged` (never).
 */
const countRange = (
  output: string
): { ahead: number; behind: number } | undefined => {
  const [ahead, behind] = output.trim().split(WHITESPACE).map(Number);
  if (
    ahead === undefined ||
    behind === undefined ||
    !Number.isFinite(ahead) ||
    !Number.isFinite(behind)
  ) {
    return undefined;
  }
  return { ahead, behind };
};

/**
 * Where this checkout stands, right now. The marker is checked *before* any git
 * runs at all: in an unmarked tree not even a fetch happens, so the poller has
 * no side effect whatsoever on a machine that was never deployed to.
 */
export const checkDeploy = async ({
  root = deployRoot(),
  git = runGit,
}: DeployCheckOptions = {}): Promise<DeployState> => {
  const marker = await readDeployMarker(root);
  if (!marker) {
    return { kind: "unmarked", root };
  }

  const branch = marker.branch || DEPLOY_BRANCH;
  const remote = `origin/${branch}`;

  const head = await git(root, ["rev-parse", "--short", "HEAD"]);
  if (!head.ok) {
    return {
      kind: "unreachable",
      root,
      reason: head.err || `${root} is not a git checkout`,
    };
  }

  const fetched = await git(root, ["fetch", "origin", branch]);
  if (!fetched.ok) {
    return {
      kind: "unreachable",
      root,
      reason: fetched.err || `git fetch origin ${branch} failed`,
    };
  }

  const target = await git(root, ["rev-parse", "--short", remote]);
  if (!target.ok) {
    return {
      kind: "unreachable",
      root,
      reason: target.err || `no ${remote} in ${root}`,
    };
  }

  const counted = await git(root, [
    "rev-list",
    "--left-right",
    "--count",
    `HEAD...${remote}`,
  ]);
  const range = counted.ok ? countRange(counted.out) : undefined;
  if (!range) {
    return {
      kind: "unreachable",
      root,
      reason: counted.err || `could not compare HEAD with ${remote} in ${root}`,
    };
  }

  const { ahead, behind } = range;
  if (ahead > 0 && behind > 0) {
    return {
      kind: "diverged",
      root,
      head: head.out,
      target: target.out,
      ahead,
      behind,
    };
  }
  if (behind > 0) {
    return { kind: "behind", root, head: head.out, target: target.out, behind };
  }
  if (ahead > 0) {
    return { kind: "ahead", root, head: head.out, target: target.out, ahead };
  }
  return { kind: "current", root, head: head.out };
};

/** One sentence per state, for a log line and for the board's tooltip alike. */
export const describeDeploy = (state: DeployState): string => {
  switch (state.kind) {
    case "unmarked":
      return `${state.root} carries no ${DEPLOY_MARKER}, so it is a working tree and will never be auto-updated`;
    case "unreachable":
      return `${state.root} could not be compared with its branch: ${state.reason}`;
    case "current":
      return `${state.root} is level with origin at ${state.head}`;
    case "behind":
      return `${state.root} is ${state.behind} commit(s) behind origin: ${state.head} → ${state.target}`;
    case "ahead":
      return `${state.root} has ${state.ahead} local commit(s) origin does not, so there is nothing to pull (head ${state.head})`;
    case "diverged":
      return `${state.root} has DIVERGED from origin — ${state.ahead} local commit(s) and ${state.behind} upstream, head ${state.head} vs ${state.target}. Refusing to update: a reset here would destroy work nobody has a copy of. Resolve it by hand.`;
    default:
      // Exhaustive over DeployState["kind"]; TypeScript enforces every case above.
      return state;
  }
};

/** Whether a state is something an operator should be shown rather than ignore. */
export const isDeploySkew = (state: DeployState): boolean =>
  state.kind === "diverged" ||
  state.kind === "ahead" ||
  state.kind === "unreachable";

/** What one poll did, beyond what the state alone says. */
export interface DeployTick {
  /** What the update flow threw, if it threw. */
  readonly failure?: string;
  readonly state: DeployState;
  /** Whether the update flow was invoked on this tick. */
  readonly updated: boolean;
}

/**
 * A tick, flattened onto the shape the wire and the board share
 * ({@link DeployInfo} in `@whiffle/core`). Everything the fuller
 * {@link DeployState} carries — heads, targets, the two counts — is already in
 * the sentence {@link describeDeploy} writes, so the wire carries one kind and
 * one sentence rather than six shapes the reader would have to re-narrate.
 */
export const deployInfo = (tick: DeployTick): DeployInfo => ({
  kind: tick.state.kind,
  detail: describeDeploy(tick.state),
  ...(tick.updated ? { updated: true } : {}),
  ...(tick.failure ? { failure: tick.failure } : {}),
});

/**
 * The most recent tick any watcher in this process produced, and `undefined`
 * until one has. Module-scoped on purpose: the register and the 15s heartbeat
 * are written in `daemon.ts`, which must not own — or start — a poller to be
 * able to say what the last one saw. Nothing here ever polls: a process that
 * never starts a watcher reports no deploy state at all, and the board renders
 * nothing, which is exactly what a machine outside the deployment channel
 * should show.
 */
let latest: DeployInfo | undefined;

export const latestDeploy = (): DeployInfo | undefined => latest;

/** Test seam, and the reset every test that touches {@link latestDeploy} owes the next one. */
export const forgetLatestDeploy = (): void => {
  latest = undefined;
};

export interface DeployWatcherOptions {
  readonly git?: GitRunner;
  /**
   * Where a tick goes. The default logs; the hub-facing surface (leaf C2)
   * subscribes here rather than reaching into this module.
   */
  readonly report?: (tick: DeployTick) => void;
  readonly root?: string;
  /**
   * The update flow. Left injectable for exactly one reason: this thing pulls
   * and restarts services, and a test must be able to prove the *decision*
   * without performing it.
   */
  readonly update: (
    state: Extract<DeployState, { kind: "behind" }>
  ) => Promise<unknown>;
}

const say = (line: string): void => console.error(`whiffle deploy: ${line}`);

/**
 * The default report: every skew and every deploy is spoken once, and a state
 * that has not changed is not spoken again. A minute-by-minute poller that
 * printed its verdict every time would bury the one line that matters under
 * 1,440 identical ones a day, which is the same as not surfacing it.
 */
const defaultReport = (() => {
  let last = "";
  return (tick: DeployTick): void => {
    const signature = `${tick.state.kind}:${"target" in tick.state ? tick.state.target : ""}:${tick.failure ?? ""}`;
    if (signature === last) {
      return;
    }
    last = signature;
    if (tick.failure) {
      say(`update failed: ${tick.failure}`);
    } else if (tick.updated || isDeploySkew(tick.state)) {
      say(describeDeploy(tick.state));
    }
  };
})();

/**
 * The poller's state machine, with no timer in it. Every decision this leaf
 * cares about is a `tick()` away, so the tests exercise the real thing without
 * anything running on a schedule.
 */
export class DeployWatcher {
  readonly #options: DeployWatcherOptions;
  /**
   * The last upstream head an update was *attempted* for, so a push triggers
   * exactly one update run — not one per minute until the pull happens to
   * take. Attempted, not succeeded: a broken commit that fails to build must
   * not be retried in a loop, it must be fixed and pushed over.
   */
  #attempted?: string;
  /** A poll is skipped outright while an update is still running. */
  #busy = false;
  #last?: DeployTick;

  constructor(options: DeployWatcherOptions) {
    this.#options = options;
  }

  get last(): DeployTick | undefined {
    return this.#last;
  }

  async tick(): Promise<DeployTick> {
    // biome-ignore lint/suspicious/noUnnecessaryConditions: #busy is reassigned true/false further down; Biome doesn't track private field mutation across the class
    if (this.#busy) {
      // Not a state read: an install-and-build can outlast several intervals,
      // and re-entering it would run two `bun install`s over one node_modules.
      return (
        this.#last ?? {
          state: { kind: "unmarked", root: this.#root },
          updated: false,
        }
      );
    }
    const state = await checkDeploy({
      root: this.#options.root,
      git: this.#options.git,
    });
    const tick = await this.#act(state);
    this.#last = tick;
    // Recorded before the report runs, and regardless of which report it is: a
    // caller that injects its own `report` (the tests do) must not thereby
    // silence the wire, and a report that throws must not lose the state.
    latest = deployInfo(tick);
    (this.#options.report ?? defaultReport)(tick);
    return tick;
  }

  get #root(): string {
    return this.#options.root ?? deployRoot();
  }

  async #act(state: DeployState): Promise<DeployTick> {
    if (state.kind !== "behind") {
      return { state, updated: false };
    }
    if (state.target === this.#attempted) {
      return { state, updated: false };
    }
    this.#attempted = state.target;
    this.#busy = true;
    try {
      await this.#options.update(state);
      return { state, updated: true };
    } catch (error) {
      return {
        state,
        updated: false,
        failure: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.#busy = false;
    }
  }
}

export interface DeployPoller {
  stop: () => void;
  readonly watcher: DeployWatcher;
}

/**
 * Starts the 60 s poll. `unref` so a daemon that is otherwise finished is not
 * held alive by a timer waiting to ask git a question.
 */
export const startDeployPoller = (
  options: DeployWatcherOptions & { readonly intervalMs?: number }
): DeployPoller => {
  const watcher = new DeployWatcher(options);
  const timer = setInterval(() => {
    // biome-ignore lint/complexity/noVoid: fire-and-forget by intent — the interval callback doesn't await its own tick
    void watcher.tick();
  }, options.intervalMs ?? DEPLOY_POLL_MS);
  timer.unref?.();
  return { watcher, stop: () => clearInterval(timer) };
};
