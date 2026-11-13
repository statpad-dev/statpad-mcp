import type { Play } from '@statpad/sdk';
import { afterEach, describe, expect, it } from 'vitest';

import { MAX_TOKENS, TARGET_TOKENS } from '../src/output.js';
import { connect, type Harness, type HarnessOptions } from './helpers/harness.js';
import { EPL_GAME, fixture, NCAAF_GAME, NFL_GAME } from './helpers/stub.js';

let h: Harness | undefined;
async function open(options: HarnessOptions = {}): Promise<Harness> {
  h = await connect(options);
  return h;
}
afterEach(async () => {
  await h?.close();
  h = undefined;
});

describe('list_leagues', () => {
  it('lists the leagues the key can read, in one request', async () => {
    const result = await (await open()).call('list_leagues');
    expect(result.isError).toBe(false);
    expect(result.json).toEqual({
      leagues: [
        { alias: 'epl', name: 'English Premier League', sport: 'soccer', level: 'pro' },
        { alias: 'ncaaf', name: 'NCAA Division I FBS Football', sport: 'football', level: 'college' },
        { alias: 'nfl', name: 'National Football League', sport: 'football', level: 'pro' },
      ],
    });
    expect(result.structured).toEqual(result.json);
    expect(result.requests).toHaveLength(1);
    expect(new URL(result.requests[0]!.url).pathname).toBe('/v1/leagues');
  });
});

describe('find_teams', () => {
  it('finds a team by nickname and returns its id', async () => {
    const result = await (await open()).call('find_teams', { league: 'nfl', query: 'vikings' });
    expect(result.json).toEqual({
      league: 'nfl',
      query: 'vikings',
      count: 1,
      teams: [{ id: '01a1cca4-3e02-7ee2-8538-b59f1670159f', alias: 'MIN', market: 'Minnesota', name: 'Vikings' }],
    });
    expect(new URL(result.requests[0]!.url).searchParams.get('limit')).toBe('500');
  });

  it('matches market and name together, and abbreviations', async () => {
    const harness = await open();
    expect((await harness.call('find_teams', { league: 'nfl', query: 'Buffalo Bills' })).json.teams[0].alias).toBe('BUF');
    expect((await harness.call('find_teams', { league: 'nfl', query: 'jax' })).json.teams[0].name).toBe('Jaguars');
  });

  it('ignores accents', async () => {
    const teams = fixture<{ teams: Record<string, unknown>[] }>('openapi/listGames.json').teams;
    const atletico = { ...teams[0], id: '01a1b987-0000-7000-8000-000000000001', market: 'Atlético Madrid', name: 'Atlético Madrid', alias: 'ATM' };
    const result = await (await open({ teams: { epl: [atletico as never] } })).call('find_teams', { league: 'epl', query: 'atletico' });
    expect(result.json.teams.map((team: { alias: string }) => team.alias)).toEqual(['ATM']);
  });

  it('lists every team without a query', async () => {
    const result = await (await open()).call('find_teams', { league: 'nfl' });
    expect(result.json.teams.map((team: { alias: string }) => team.alias)).toEqual(['BAL', 'BUF', 'JAX', 'MIN']);
  });

  it('says when nothing matched', async () => {
    const result = await (await open()).call('find_teams', { league: 'nfl', query: 'packers' });
    expect(result.json).toMatchObject({ count: 0, teams: [], hint: expect.stringContaining('No team matched') });
  });

  it('rejects a call without league, so one call cannot fan out across leagues', async () => {
    const result = await (await open()).call('find_teams', { query: 'bills' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('league');
    expect(result.requests).toHaveLength(0);
  });
});

describe('get_game', () => {
  it('returns a final game with teams, venue and seq, and leaves out empty period scores', async () => {
    const result = await (await open()).call('get_game', { league: 'nfl', game_id: NFL_GAME });
    expect(result.json).toEqual({
      league: 'nfl',
      game_id: NFL_GAME,
      status: 'complete',
      scheduled_at: '2026-11-10T01:15:00Z',
      game_type: 'regular',
      neutral_site: false,
      away: { id: '01a1cca4-3e05-7c90-a80f-05893446d191', alias: 'BUF', name: 'Buffalo Bills' },
      home: { id: '01a1cca4-3e02-7ee2-8538-b59f1670159f', alias: 'MIN', name: 'Minnesota Vikings' },
      away_score: 23,
      home_score: 6,
      venue: { name: 'U.S. Bank Stadium', city: 'Minneapolis', state: 'MN' },
      live_state: { period: 4, away_score: 23, home_score: 6, updated_at: '2026-11-11T22:04:59.440361Z' },
      seq: 1260,
    });
    expect(result.text).not.toContain('null');
  });

  it('returns the live football situation with possession by name', async () => {
    const result = await (await open({ live: true })).call('get_game', { league: 'nfl', game_id: NFL_GAME });
    expect(result.json.status).toBe('inprogress');
    expect(result.json.live_state).toEqual({
      period: 4,
      clock: '7:02',
      possession: 'Buffalo Bills',
      away_score: 13,
      home_score: 6,
      football: { away_timeouts: 3, down: 1, home_timeouts: 2, yardline: 95, yards_to_go: 5 },
      updated_at: '2026-11-11T22:04:49.456212Z',
    });
    expect(result.json.seq).toBe(1087);
  });

  it('keeps period scores when Statpad fills them', async () => {
    const result = await (await open()).call('get_game', { league: 'ncaaf', game_id: NCAAF_GAME });
    expect(result.json.period_scores).toHaveLength(8);
    expect(result.json.period_scores[0]).toEqual({ team: 'Colorado State Rams', period: 1, period_type: 'regular', points: 7 });
  });

  it('returns the soccer situation', async () => {
    const result = await (await open()).call('get_game', { league: 'epl', game_id: EPL_GAME });
    expect(result.json.home.name).toBe('Manchester United');
    expect(result.json.live_state.soccer).toEqual({ away_formation: '4-2-3-1', away_red_cards: 0, home_formation: '4-2-3-1', home_red_cards: 0 });
  });
});

describe('get_box_score', () => {
  it('summarizes the 68-player game within the default budget, and says how to see the rest', async () => {
    const result = await (await open()).call('get_box_score', { league: 'nfl', game_id: NFL_GAME });
    expect(result.isError).toBe(false);
    expect(result.tokens).toBeLessThanOrEqual(TARGET_TOKENS);
    expect(result.json.truncated).toBe(true);
    expect(result.json.hint).toContain('Filter by team, player or category');
    expect(result.json.lines).toBe(92);
    expect(Object.keys(result.json.categories).slice(0, 3)).toEqual(['passing', 'rushing', 'receiving']);
    expect(result.json.categories.passing[0]).toMatchObject({ player: 'Josh Allen', team: 'BUF', stats: { yards: 234, touchdowns: 1 } });
    expect(result.requests).toHaveLength(3);
  });

  it('filters by team abbreviation and category', async () => {
    const result = await (await open()).call('get_box_score', { league: 'nfl', game_id: NFL_GAME, team: 'buf', category: 'receiving' });
    const lines = result.json.categories.receiving as { team: string }[];
    expect(Object.keys(result.json.categories)).toEqual(['receiving']);
    expect(lines.length).toBe(result.json.lines);
    expect(lines.every((line) => line.team === 'BUF')).toBe(true);
    expect(result.json.truncated).toBeUndefined();
  });

  it('keeps a team filter within the hard cap', async () => {
    const result = await (await open()).call('get_box_score', { league: 'nfl', game_id: NFL_GAME, team: 'MIN' });
    expect(result.tokens).toBeLessThanOrEqual(MAX_TOKENS);
  });

  it('finds a player by part of the name, ignoring accents', async () => {
    const result = await (await open()).call('get_box_score', { league: 'epl', game_id: EPL_GAME, player: 'lindelof' });
    expect(result.json.lines).toBe(1);
    expect(result.json.categories.soccer[0]).toMatchObject({ player: 'Victor Lindelöf', team: 'AVL', position: 'CD-R' });
  });

  it('says which teams are in the game when the team filter matches neither', async () => {
    const result = await (await open()).call('get_box_score', { league: 'nfl', game_id: NFL_GAME, team: 'KC' });
    expect(result.isError).toBe(true);
    expect(result.json.message).toContain('BUF');
    expect(result.json.message).toContain('MIN');
  });

  it('lists the categories when a category filter matches nothing', async () => {
    const result = await (await open()).call('get_box_score', { league: 'nfl', game_id: NFL_GAME, category: 'soccer' });
    expect(result.json.lines).toBe(0);
    expect(result.json.note).toContain('passing');
  });
});

describe('get_plays', () => {
  it('returns the last 10 plays of the 187-play game by default', async () => {
    const result = await (await open()).call('get_plays', { league: 'nfl', game_id: NFL_GAME });
    expect(result.json).toMatchObject({ mode: 'recent', total_plays: 187, count: 187, seq: 1260 });
    expect(result.json.plays).toHaveLength(10);
    expect(result.json.plays.at(-1)).toEqual({ period: 4, clock: '0:00', team: 'Buffalo Bills', type: 'other', description: 'END GAME', away_score: 23, home_score: 6 });
    expect(result.tokens).toBeLessThanOrEqual(TARGET_TOKENS);
    expect(result.requests).toHaveLength(2);
    expect(new URL(result.requests.find((r) => r.url.includes('/plays'))!.url).searchParams.get('limit')).toBe('1000');
  });

  it('keeps 50 plays within the hard cap', async () => {
    const result = await (await open()).call('get_plays', { league: 'nfl', game_id: NFL_GAME, limit: 50 });
    expect(result.json.plays).toHaveLength(50);
    expect(result.tokens).toBeLessThanOrEqual(MAX_TOKENS);
  });

  it('returns only scoring plays', async () => {
    const result = await (await open()).call('get_plays', { league: 'nfl', game_id: NFL_GAME, mode: 'scoring' });
    expect(result.json.count).toBe(7);
    expect(result.json.plays.map((play: { points: number }) => play.points)).toEqual([3, 3, 7, 3, 3, 7, 3]);
    expect(result.json.plays.at(-1)).toMatchObject({ away_score: 23, home_score: 6 });
  });

  it('formats soccer minutes with stoppage time', async () => {
    const result = await (await open()).call('get_plays', { league: 'epl', game_id: EPL_GAME, mode: 'scoring' });
    expect(result.json.count).toBe(8);
    expect(result.json.plays.at(-1)).toMatchObject({ clock: "90+6'", team: 'Manchester United', away_score: 4, home_score: 4 });
  });

  it('returns drives with result, team, yards, points and duration', async () => {
    const result = await (await open()).call('get_plays', { league: 'nfl', game_id: NFL_GAME, mode: 'drives' });
    expect(result.json.count).toBe(25);
    expect(result.json.drives[0]).toEqual({
      kind: 'drive',
      period: 1,
      team: 'Buffalo Bills',
      result: 'Punt',
      plays: 3,
      yards: -11,
      first_downs: 0,
      points: 0,
      duration: '1:57',
      start_clock: '15:00',
      start_yardline: 64,
      end_yardline: 53,
    });
    expect(result.json.seq).toBe(1260);
  });

  it('explains that soccer has no drives', async () => {
    const result = await (await open()).call('get_plays', { league: 'epl', game_id: EPL_GAME, mode: 'drives' });
    expect(result.json.drives).toEqual([]);
    expect(result.json.note).toContain('Soccer');
  });

  it('pages a long game, and says when the budget cannot reach the latest plays', async () => {
    const base = fixture<{ data: Play[] }>('nfl-bills-at-vikings/plays.json').data[0]!;
    const plays = Array.from({ length: 2_500 }, (_, i) => ({ ...base, id: `p${i}`, description: `play ${i}` }));
    const result = await (await open({ plays })).call('get_plays', { league: 'nfl', game_id: NFL_GAME });
    expect(result.requests).toHaveLength(3);
    expect(result.json.total_plays).toBe(2_000);
    expect(result.json.plays.at(-1).description).toBe('play 1999');
    expect(result.json.truncated).toBe(true);
    expect(result.json.note).toContain('not the latest plays');
  });

  it('reads two pages when a game has more than 1,000 plays', async () => {
    const base = fixture<{ data: Play[] }>('nfl-bills-at-vikings/plays.json').data[0]!;
    const plays = Array.from({ length: 1_500 }, (_, i) => ({ ...base, id: `p${i}`, description: `play ${i}` }));
    const result = await (await open({ plays })).call('get_plays', { league: 'nfl', game_id: NFL_GAME });
    expect(result.requests).toHaveLength(3);
    expect(result.json.plays.at(-1).description).toBe('play 1499');
    expect(result.json.note).toBeUndefined();
  });
});

describe('get_plays after_seq', () => {
  it('returns the play changes since a seq and the seq to continue from', async () => {
    const harness = await open();
    const first = await harness.call('get_plays', { league: 'nfl', game_id: NFL_GAME, after_seq: 1200 });
    expect(first.json).toMatchObject({ after_seq: 1200, head_seq: 1260, caught_up: false });
    expect(first.json.plays).toHaveLength(10);
    expect(first.json.plays[0]).toMatchObject({ op: 'upsert', period: 4, team: 'Minnesota Vikings' });
    expect(first.json.seq).toBeGreaterThan(1200);
    expect(first.json.hint).toContain(`after_seq ${first.json.seq}`);

    const second = await harness.call('get_plays', { league: 'nfl', game_id: NFL_GAME, after_seq: first.json.seq, limit: 50 });
    expect(second.json.caught_up).toBe(true);
    expect(second.json.seq).toBe(1260);
    const firstIds = new Set(first.json.plays.map((play: { id: string }) => play.id));
    expect(second.json.plays.some((play: { id: string }) => firstIds.has(play.id))).toBe(false);
    expect(second.json.live_state.updated_at).toBeDefined();
  });

  it('returns nothing new when already caught up', async () => {
    const result = await (await open()).call('get_plays', { league: 'nfl', game_id: NFL_GAME, after_seq: 1260 });
    expect(result.json).toMatchObject({ caught_up: true, plays: [], seq: 1260 });
  });

  it('keeps the catch-up from seq 0 within the budget and never skips a play', async () => {
    const harness = await open();
    let seq = 0;
    const seen: string[] = [];
    for (let page = 0; page < 200; page++) {
      const result = await harness.call('get_plays', { league: 'nfl', game_id: NFL_GAME, after_seq: seq, limit: 50 });
      expect(result.tokens).toBeLessThanOrEqual(MAX_TOKENS);
      seen.push(...result.json.plays.map((play: { id: string }) => play.id));
      seq = result.json.seq;
      if (result.json.caught_up) break;
    }
    expect(seq).toBe(1260);
    expect(seen).toHaveLength(270);
  });

  it('falls back to a fresh game read on resync_required', async () => {
    const result = await (await open({ minSeq: 500 })).call('get_plays', { league: 'nfl', game_id: NFL_GAME, after_seq: 40 });
    expect(result.isError).toBe(false);
    expect(result.json).toMatchObject({ resync_required: true, after_seq: 40, seq: 1260, plays: [] });
    expect(result.json.note).toContain('500');
    expect(result.json.note).toContain('Resync');
    expect(result.requests).toHaveLength(2);
  });

  it('rejects after_seq with drives', async () => {
    const result = await (await open()).call('get_plays', { league: 'nfl', game_id: NFL_GAME, mode: 'drives', after_seq: 10 });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('after_seq');
  });
});
