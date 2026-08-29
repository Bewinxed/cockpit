export { probeAuth } from './auth';
export { buildInfo } from './build';
export { ConnectionLost, runDaemon, startDaemon, type RegisterPayload } from './daemon';
export {
  browseMdns,
  firstToAnswer,
  MDNS_BROWSE_MS,
  probeHub,
  PROBE_TIMEOUT_MS,
  rediscoverHub,
  tailscaleCandidates,
  toHttpBase,
  toWsUrl,
  type RediscoverProbes,
} from './discovery';
export { machineId } from './machine-id';
export { SessionSupervisor, type FrameSink } from './session';
export {
  checkDeploy,
  DEPLOY_BRANCH,
  DEPLOY_MARKER,
  DEPLOY_POLL_MS,
  deployRoot,
  describeDeploy,
  isDeployClone,
  readDeployMarker,
  type DeployMarker,
  type DeployState,
} from './deploy';
export {
  deploymentState,
  updateCheckout,
  watchDeployment,
  type DeployWatchOptions,
  type UpdateOptions,
} from './update';
