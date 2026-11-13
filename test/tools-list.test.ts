import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { VERSION } from '../src/version.js';
import { connect, type Harness } from './helpers/harness.js';

describe('tools/list', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await connect();
  });
  afterEach(async () => {
    await h.close();
  });

  it('matches the schema contract snapshot', async () => {
    const { tools } = await h.client.listTools();
    await expect(JSON.stringify(tools, null, 2) + '\n').toMatchFileSnapshot('./__snapshots__/tools-list.json');
  });

  it('marks every tool read-only and open-world, with a title', async () => {
    const { tools } = await h.client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(['list_leagues', 'find_teams', 'find_games', 'get_game', 'get_box_score', 'get_plays']);
    for (const tool of tools) {
      expect(tool.title).toBeTruthy();
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
      expect(tool.outputSchema).toBeDefined();
    }
  });

  it('requires league wherever a tool reads a league', async () => {
    const { tools } = await h.client.listTools();
    for (const tool of tools.filter((t) => t.name !== 'list_leagues')) {
      expect(tool.inputSchema.required).toContain('league');
    }
  });

  it('serves instructions that say what is and is not covered', async () => {
    const instructions = h.client.getInstructions() ?? '';
    for (const phrase of ['list_leagues', 'standings', 'injuries', 'transactions', 'odds', 'season stats', 'player search', 'America/New_York', 'live']) {
      expect(instructions).toContain(phrase);
    }
  });

  it('keeps server.json in step with package.json', () => {
    const read = (file: string) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
    const pkg = read('package.json');
    const server = read('server.json');
    expect(server.name).toBe(pkg.mcpName);
    expect(server.version).toBe(pkg.version);
    expect(server.packages[0]).toMatchObject({ registryType: 'npm', identifier: pkg.name, version: pkg.version, transport: { type: 'stdio' } });
    expect(server.description.length).toBeLessThanOrEqual(100);
  });

  it('reports the package version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
    expect(h.client.getServerVersion()?.version).toBe(pkg.version);
  });
});

describe('a 2025-era client', () => {
  it('connects over the in-memory linked pair and calls a tool', async () => {
    const h = await connect({ era: 'legacy' });
    const { tools } = await h.client.listTools();
    expect(tools).toHaveLength(6);
    const result = await h.call('list_leagues');
    expect(result.isError).toBe(false);
    expect(result.json.leagues).toHaveLength(3);
    await h.close();
  });
});
