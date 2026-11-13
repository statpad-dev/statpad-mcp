import { afterEach, describe, expect, it } from 'vitest';

import { REQUEST_BUDGET } from '../src/context.js';
import { MAX_TOKENS, TARGET_TOKENS } from '../src/output.js';
import { connect, type Harness, type HarnessOptions } from './helpers/harness.js';
import { EPL_GAME, NCAAF_GAME, NFL_GAME, TEST_KEY } from './helpers/stub.js';

let h: Harness | undefined;
async function open(options: HarnessOptions = {}): Promise<Harness> {
  h = await connect(options);
  return h;
}
afterEach(async () => {
  await h?.close();
  h = undefined;
});

/** One call of every tool and mode, the default-sized ones first. */
const DEFAULT_CALLS: [string, Record<string, unknown>][] = [
  ['list_leagues', {}],
  ['find_teams', { league: 'nfl' }],
  ['find_teams', { league: 'nfl', query: 'bills' }],
  ['find_games', { league: 'nfl', date: 'today' }],
  ['find_games', { league: 'nfl', date: 'today', team: 'Bills' }],
  ['find_games', { league: 'nfl', live: true, team: 'Bills' }],
  ['find_games', { league: 'nfl', from: '2026-11-01T00:00:00Z', to: '2026-12-01T00:00:00Z' }],
  ['get_game', { league: 'nfl', game_id: NFL_GAME }],
  ['get_game', { league: 'ncaaf', game_id: NCAAF_GAME }],
  ['get_box_score', { league: 'nfl', game_id: NFL_GAME }],
  ['get_box_score', { league: 'epl', game_id: EPL_GAME }],
  ['get_plays', { league: 'nfl', game_id: NFL_GAME }],
  ['get_plays', { league: 'nfl', game_id: NFL_GAME, mode: 'scoring' }],
  ['get_plays', { league: 'nfl', game_id: NFL_GAME, mode: 'drives' }],
  ['get_plays', { league: 'nfl', game_id: NFL_GAME, after_seq: 0 }],
  ['get_plays', { league: 'epl', game_id: EPL_GAME }],
];

const LARGE_CALLS: [string, Record<string, unknown>][] = [
  ['get_box_score', { league: 'nfl', game_id: NFL_GAME, team: 'MIN' }],
  ['get_box_score', { league: 'nfl', game_id: NFL_GAME, category: 'defensive' }],
  ['get_plays', { league: 'nfl', game_id: NFL_GAME, limit: 50 }],
  ['get_plays', { league: 'epl', game_id: EPL_GAME, limit: 50 }],
  ['get_plays', { league: 'nfl', game_id: NFL_GAME, after_seq: 0, limit: 50 }],
];

describe('budgets', () => {
  it('keeps every call within the request budget and the default size, and reports the sizes', async () => {
    const harness = await open({ now: new Date('2026-11-10T03:00:00Z') });
    const sizes: { call: string; requests: number; tokens: number }[] = [];
    for (const [name, args] of DEFAULT_CALLS) {
      const result = await harness.call(name, args);
      expect(result.isError, `${name} ${JSON.stringify(args)}: ${result.text}`).toBe(false);
      expect(result.requests.length).toBeLessThanOrEqual(REQUEST_BUDGET);
      expect(result.tokens).toBeLessThanOrEqual(TARGET_TOKENS);
      sizes.push({ call: `${name} ${JSON.stringify(args)}`, requests: result.requests.length, tokens: result.tokens });
    }
    for (const [name, args] of LARGE_CALLS) {
      const result = await harness.call(name, args);
      expect(result.isError).toBe(false);
      expect(result.requests.length).toBeLessThanOrEqual(REQUEST_BUDGET);
      expect(result.tokens).toBeLessThanOrEqual(MAX_TOKENS);
      sizes.push({ call: `${name} ${JSON.stringify(args)}`, requests: result.requests.length, tokens: result.tokens });
    }
    console.log(sizes.map((s) => `${String(s.tokens).padStart(5)} tokens  ${s.requests} req  ${s.call}`).join('\n'));
  });
});

describe('the API key', () => {
  it('is sent only in the Authorization header, with the statpad-mcp User-Agent', async () => {
    const result = await (await open()).call('list_leagues');
    const request = result.requests[0]!;
    expect(request.headers.get('Authorization')).toBe(`Bearer ${TEST_KEY}`);
    expect(request.headers.get('User-Agent')).toBe('statpad-mcp/0.1.0 (stdio)');
    expect(request.url).not.toContain(TEST_KEY);
  });

  it('never appears in any result or log line', async () => {
    const harness = await open({ now: new Date('2026-11-10T03:00:00Z') });
    const texts: string[] = [];
    for (const [name, args] of [...DEFAULT_CALLS, ...LARGE_CALLS, ['find_teams', { league: 'nba' }] as const, ['get_game', { league: 'nfl', game_id: 'x' }] as const]) {
      const result = await harness.call(name, args);
      texts.push(result.text, JSON.stringify(result.structured ?? null));
    }
    const { tools } = await harness.client.listTools();
    texts.push(JSON.stringify(tools), harness.client.getInstructions() ?? '', ...harness.logs);
    expect(harness.logs.length).toBeGreaterThan(0);
    for (const text of texts) expect(text).not.toContain(TEST_KEY);
    for (const text of texts) expect(text).not.toContain(TEST_KEY.split('.')[1]);
  });
});

describe('the allowance warning', () => {
  it('appears when under 5% of the period allowance remains', async () => {
    const result = await (await open({ remaining: 20_000 })).call('list_leagues');
    expect(result.json.warning).toContain('20000');
    expect(result.json.warning).toContain('500000');
    expect(result.json.warning).toContain('renews in about 20 days');
    expect((result.structured as { warning: string }).warning).toBe(result.json.warning);
  });

  it('stays away at 5% or more', async () => {
    const result = await (await open({ remaining: 25_000 })).call('list_leagues');
    expect(result.json.warning).toBeUndefined();
  });
});
