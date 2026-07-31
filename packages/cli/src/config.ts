import { homedir } from 'node:os';
import { join } from 'node:path';

/** Everything the CLI remembers between runs: where the hub was, last time. */
export interface CliConfig {
  hubUrl: string;
  updatedAt: string;
}

export const CONFIG_PATH = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
  'cockpit',
  'config.json'
);

/** Undefined for a first run, and for a file someone has since broken. */
export const readConfig = async (): Promise<CliConfig | undefined> => {
  const file = Bun.file(CONFIG_PATH);
  if (!(await file.exists())) return undefined;
  const config = await file.json().catch(() => undefined);
  return typeof config?.hubUrl === 'string' ? (config as CliConfig) : undefined;
};

export const writeConfig = async (hubUrl: string): Promise<void> => {
  const config: CliConfig = { hubUrl, updatedAt: new Date().toISOString() };
  await Bun.write(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
};
