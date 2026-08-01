import { chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Everything the CLI remembers between runs: where the hub was, last time. */
export interface CliConfig {
  hubUrl: string;
  /**
   * A `claude setup-token` token, for a machine whose daemon cannot reach the
   * credentials the user logged in with — a headless Linux box, or a Mac whose
   * daemon runs outside the desktop session. Exported as
   * `CLAUDE_CODE_OAUTH_TOKEN`, which bypasses the keychain entirely.
   */
  claudeToken?: string;
  updatedAt: string;
}

export const CONFIG_PATH = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
  'cockpit',
  'config.json'
);

/** The config can name a credential, so it is readable by its owner and nobody else. */
const CONFIG_MODE = 0o600;

/** Undefined for a first run, and for a file someone has since broken. */
export const readConfig = async (): Promise<CliConfig | undefined> => {
  const file = Bun.file(CONFIG_PATH);
  if (!(await file.exists())) return undefined;
  const config = await file.json().catch(() => undefined);
  return typeof config?.hubUrl === 'string' ? (config as CliConfig) : undefined;
};

/**
 * Merges over what is already there: remembering a hub must not drop the token,
 * and signing in must not forget the hub. The mode is set after the write
 * because it has to be re-applied to a file that already existed.
 */
export const writeConfig = async (patch: Partial<CliConfig>): Promise<void> => {
  const config: CliConfig = {
    hubUrl: '',
    ...(await readConfig()),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await Bun.write(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
  await chmod(CONFIG_PATH, CONFIG_MODE);
};
