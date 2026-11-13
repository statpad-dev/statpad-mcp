import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const apiKey = process.env.STATPAD_API_KEY;
if (!apiKey) throw new Error('test:live needs STATPAD_API_KEY, a key for an account that can read at least one league');

const server = fileURLToPath(new URL('../../dist/stdio.js', import.meta.url));
const finished = new Set(['complete', 'closed']);
const days = 14;

type Result = { isError: boolean; json: Record<string, unknown>; structured: unknown };
type Era = { name: string; negotiation?: { mode: { pin: string } } };

const eras: Era[] = [{ name: 'a legacy client' }, { name: 'a client pinned to 2026-07-28', negotiation: { mode: { pin: '2026-07-28' } } }];

describe.each(eras)('over stdio with $name', ({ negotiation }) => {
  const stderr: string[] = [];
  const outputs: string[] = [];
  let client: Client;

  async function call(name: string, args: Record<string, unknown> = {}): Promise<Result> {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
    outputs.push(text);
    return { isError: result.isError === true, json: JSON.parse(text) as Record<string, unknown>, structured: result.structuredContent };
  }

  async function ok(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const result = await call(name, args);
    expect(result.isError, `${name} returned an error: ${JSON.stringify(result.json)}`).toBe(false);
    expect(result.structured).toEqual(result.json);
    return result.json;
  }

  beforeAll(async () => {
    const env = { ...process.env, STATPAD_API_KEY: apiKey } as Record<string, string>;
    const transport = new StdioClientTransport({ command: process.execPath, args: [server], env, stderr: 'pipe' });
    transport.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString()));
    client = new Client({ name: 'statpad-mcp-live', version: '1.0.0' }, negotiation ? { versionNegotiation: negotiation } : {});
    await client.connect(transport);
  });

  afterAll(async () => {
    await client?.close();
    const all = [...outputs, ...stderr].join('\n');
    expect(all.includes(apiKey)).toBe(false);
    expect(all.includes(apiKey.split('.')[1] ?? apiKey)).toBe(false);
  });

  it('negotiates the expected protocol', () => {
    if (negotiation) {
      expect(client.getProtocolEra()).toBe('modern');
      expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28');
    } else {
      expect(client.getProtocolEra()).not.toBe('modern');
    }
  });

  it('answers every tool on the last finished game it can find', async () => {
    const { leagues } = (await ok('list_leagues')) as { leagues: Array<{ alias: string }> };
    expect(leagues.length).toBeGreaterThan(0);

    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    let league: string | undefined;
    let game: { id: string; status: string } | undefined;
    for (const { alias } of leagues) {
      const { games } = (await ok('find_games', { league: alias, from: from.toISOString(), to: to.toISOString() })) as {
        games: Array<{ id: string; status: string }>;
      };
      game = games.filter((g) => finished.has(g.status)).at(-1);
      if (game) {
        league = alias;
        break;
      }
    }
    expect(game, `no finished game in the last ${days} days in ${leagues.map((l) => l.alias).join(', ')}`).toBeDefined();

    const { count } = (await ok('find_teams', { league })) as { count: number };
    expect(count).toBeGreaterThan(0);

    const detail = await ok('get_game', { league, game_id: game!.id });
    expect(JSON.stringify(detail)).toContain(game!.id);

    await ok('get_box_score', { league, game_id: game!.id });

    const recent = (await ok('get_plays', { league, game_id: game!.id, limit: 5 })) as { plays?: unknown[] };
    expect(recent.plays?.length ?? 0).toBeGreaterThan(0);
    await ok('get_plays', { league, game_id: game!.id, mode: 'scoring' });
  });

  it('maps an unknown game to not_found', async () => {
    const { leagues } = (await ok('list_leagues')) as { leagues: Array<{ alias: string }> };
    const result = await call('get_game', { league: leagues[0]!.alias, game_id: crypto.randomUUID() });
    expect(result.isError).toBe(true);
    expect(result.json.error).toBe('not_found');
  });
});
