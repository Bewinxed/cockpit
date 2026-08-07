import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeMcp, pluginSkillRoots, skillDescription, skillsIn } from './fleet';

/**
 * Discovery (NEW.md §11): what a machine really has, whoever put it there.
 * Everything here runs against a scratch directory or a plain object — the
 * machine's own `~/.claude` is what this feature reads, never what it tests on.
 */
const scratch = await mkdtemp(join(tmpdir(), 'cockpit-discovery-'));
afterAll(() => rm(scratch, { recursive: true, force: true }));

const stdio = (command: string) => ({ command });

test('a name in two scopes: the nearer wins and the further says so', () => {
  const found = mergeMcp(
    [
      { scope: 'local', servers: { linear: stdio('local-linear') } },
      { scope: 'project', servers: { linear: stdio('project-linear'), repo: stdio('repo') } },
      { scope: 'user', servers: { linear: stdio('user-linear'), exa: stdio('exa') } },
    ],
    []
  );

  const linear = found.filter((row) => row.name === 'linear');
  expect(linear.map((row) => row.scope)).toEqual(['local', 'project', 'user']);
  expect(linear.map((row) => row.shadowedBy)).toEqual([undefined, 'local', 'local']);
  // A name nobody else defines is nobody's shadow.
  expect(found.find((row) => row.name === 'exa')?.shadowedBy).toBeUndefined();
  expect(found.find((row) => row.name === 'repo')?.shadowedBy).toBeUndefined();
});

test('only the user scope can be cockpit\'s, and only what the sidecar names', () => {
  const found = mergeMcp(
    [
      { scope: 'project', servers: { exa: stdio('project-exa') } },
      { scope: 'user', servers: { exa: stdio('user-exa'), mine: stdio('mine') } },
    ],
    ['exa']
  );

  expect(found.find((row) => row.scope === 'user' && row.name === 'exa')?.managed).toBe(true);
  expect(found.find((row) => row.scope === 'project')?.managed).toBe(false);
  expect(found.find((row) => row.name === 'mine')?.managed).toBe(false);
});

test('a plugin names its skills the way a session calls them', async () => {
  const installPath = join(scratch, 'cache', 'interfaces', 'interfaces', '1.0.0');
  await Bun.write(
    join(installPath, 'skills', 'better-ui', 'SKILL.md'),
    '---\nname: better-ui\ndescription: Details that make interfaces feel better.\n---\n\n# Body\n'
  );
  await Bun.write(join(installPath, 'skills', 'better-colors', 'SKILL.md'), '# No front matter\n');
  // A directory without a SKILL.md is not a skill, whatever else is in it.
  await Bun.write(join(installPath, 'skills', 'notes', 'README.md'), 'not a skill\n');

  const roots = pluginSkillRoots({
    plugins: { 'interfaces@interfaces': [{ scope: 'user', installPath }] },
  });
  expect(roots).toEqual([{ plugin: 'interfaces', root: join(installPath, 'skills') }]);

  const found = await skillsIn(roots[0].root, 'plugin', 'interfaces:');
  expect(found.map((skill) => skill.name).sort()).toEqual([
    'interfaces:better-colors',
    'interfaces:better-ui',
  ]);
  expect(found.every((skill) => skill.scope === 'plugin')).toBe(true);
  expect(found.find((skill) => skill.name === 'interfaces:better-ui')?.description).toBe(
    'Details that make interfaces feel better.'
  );
  expect(found.find((skill) => skill.name === 'interfaces:better-colors')?.description).toBeUndefined();
});

test('a plugin installed nowhere yields no roots', () => {
  expect(pluginSkillRoots({})).toEqual([]);
  expect(pluginSkillRoots({ plugins: { 'x@y': [{ scope: 'user' }] } })).toEqual([]);
});

test('a directory that is not there is a machine with no skills of that scope', async () => {
  expect(await skillsIn(join(scratch, 'nothing-here'), 'user')).toEqual([]);
});

test('a symlinked skill is a skill — which is how the CLIs install them', async () => {
  const real = join(scratch, 'agents-skills', 'humanizer');
  await Bun.write(join(real, 'SKILL.md'), '---\nname: humanizer\n---\n');
  const links = join(scratch, 'linked-skills');
  await Bun.write(join(links, '.keep'), '');
  await symlink(real, join(links, 'humanizer'));

  const found = await skillsIn(links, 'user');
  expect(found.map((skill) => skill.name)).toEqual(['humanizer']);
});

test('a plugin that files its skills under categories still names them plainly', async () => {
  const root = join(scratch, 'categorised', 'skills');
  await Bun.write(join(root, 'engineering', 'tdd', 'SKILL.md'), '---\nname: tdd\n---\n');
  await Bun.write(join(root, 'productivity', 'grilling', 'SKILL.md'), '---\nname: grilling\n---\n');
  await Bun.write(join(root, 'engineering', 'README.md'), 'not a skill\n');

  const found = await skillsIn(root, 'plugin', 'mattpocock-skills:');
  expect(found.map((skill) => skill.name).sort()).toEqual([
    'mattpocock-skills:grilling',
    'mattpocock-skills:tdd',
  ]);
});

test('the description comes out of the front matter, quotes and all', () => {
  expect(skillDescription('---\nname: a\ndescription: Plain words.\n---\n')).toBe('Plain words.');
  expect(skillDescription('---\ndescription: "Quoted words."\n---\n')).toBe('Quoted words.');
  // A long one is a YAML block scalar, and the marker is not the sentence.
  expect(
    skillDescription('---\ndescription: >-\n  First line\n  second line\nname: a\n---\n')
  ).toBe('First line second line');
  // Body text that merely mentions the word is not front matter.
  expect(skillDescription('# Heading\n\ndescription: not front matter\n')).toBeUndefined();
  expect(skillDescription('---\nname: a\n---\n')).toBeUndefined();
});
