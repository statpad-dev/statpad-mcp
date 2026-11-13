import { afterEach, describe, expect, it } from 'vitest';

import { connect, type Harness, type HarnessOptions } from './helpers/harness.js';
import { BILLS, fixture, JAX_AT_BAL, NCAAF_GAME, NFL_GAME } from './helpers/stub.js';

let h: Harness | undefined;
async function open(options: HarnessOptions = {}): Promise<Harness> {
  h = await connect(options);
  return h;
}
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const query = (request: Request) => Object.fromEntries(new URL(request.url).searchParams);

describe('find_games by date', () => {
  // 03:00 UTC on November 10 is 22:00 on November 9 in New York and 03:00 on November 10 in London.
  const now = new Date('2026-11-10T03:00:00Z');

  it('resolves today in the default zone and joins team names', async () => {
    const result = await (await open({ now })).call('find_games', { league: 'nfl', date: 'today' });
    expect(result.json).toEqual({
      league: 'nfl',
      tz: 'America/New_York',
      date: '2026-11-09',
      count: 1,
      games: [
        {
          id: NFL_GAME,
          status: 'complete',
          scheduled_at: '2026-11-10T01:15:00Z',
          local_time: '2026-11-09 20:15',
          away: 'Buffalo Bills',
          home: 'Minnesota Vikings',
          away_score: 23,
          home_score: 6,
          game_type: 'regular',
          neutral_site: false,
        },
      ],
    });
    expect(query(result.requests[0]!)).toEqual({ date: '2026-11-09', tz: 'America/New_York', limit: '500' });
  });

  it('resolves today in another zone to that zone\'s date', async () => {
    const result = await (await open({ now })).call('find_games', { league: 'nfl', date: 'today', tz: 'Europe/London' });
    expect(result.json).toMatchObject({ date: '2026-11-10', tz: 'Europe/London', count: 1 });
    expect(result.json.games[0].local_time).toBe('2026-11-10 01:15');
    expect(query(result.requests[0]!)).toMatchObject({ date: '2026-11-10', tz: 'Europe/London' });
  });

  it('resolves tomorrow in each zone, and explains an empty future day', async () => {
    const harness = await open({ now });
    const newYork = await harness.call('find_games', { league: 'nfl', date: 'tomorrow' });
    expect(newYork.json).toMatchObject({ date: '2026-11-10', count: 0, games: [] });
    expect(newYork.json.note).toContain('10 minutes before kickoff');
    const london = await harness.call('find_games', { league: 'nfl', date: 'tomorrow', tz: 'Europe/London' });
    expect(london.json.date).toBe('2026-11-11');
  });

  it('resolves yesterday and passes an ISO date through', async () => {
    const harness = await open({ now });
    expect((await harness.call('find_games', { league: 'nfl', date: 'yesterday' })).json.date).toBe('2026-11-08');
    const day = await harness.call('find_games', { league: 'nfl', date: '2026-11-05' });
    expect(day.json.games.map((game: { id: string }) => game.id)).toEqual([JAX_AT_BAL]);
    expect(day.json.note).toBeUndefined();
  });

  it('rejects an unknown time zone before any request', async () => {
    const result = await (await open({ now })).call('find_games', { league: 'nfl', date: 'today', tz: 'Mars/Olympus' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('IANA');
    expect(result.requests).toHaveLength(0);
  });

  it('rejects a malformed or impossible date', async () => {
    const harness = await open({ now });
    expect((await harness.call('find_games', { league: 'nfl', date: '11/09/2026' })).isError).toBe(true);
    expect((await harness.call('find_games', { league: 'nfl', date: '2026-13-40' })).isError).toBe(true);
  });
});

describe('find_games live', () => {
  it('finds a game that started yesterday and is still in progress after midnight', async () => {
    // 05:30 UTC on November 8 is 00:30 in New York, so the 18:00 kickoff was yesterday.
    const result = await (await open({ now: new Date('2026-11-08T05:30:00Z') })).call('find_games', { league: 'ncaaf', live: true });
    expect(result.json).toMatchObject({ live: true, dates: ['2026-11-07', '2026-11-08'], tz: 'America/New_York', count: 1 });
    expect(result.json.games[0]).toMatchObject({ id: NCAAF_GAME, status: 'inprogress', away: 'Boise State Broncos', home: 'Colorado State Rams' });
    expect(result.requests.map((r) => query(r).date)).toEqual(['2026-11-07', '2026-11-08']);
  });

  it('leaves out games that are not in progress, at halftime or delayed', async () => {
    const result = await (await open({ now: new Date('2026-11-10T05:00:00Z') })).call('find_games', { league: 'nfl', live: true });
    expect(result.json).toMatchObject({ count: 0, games: [] });
    expect(result.json.note).toContain('in progress');
  });
});

describe('find_games by range', () => {
  it('passes from and to through', async () => {
    const result = await (await open()).call('find_games', { league: 'nfl', from: '2026-11-01T00:00:00Z', to: '2026-12-01T00:00:00Z' });
    expect(result.json).toMatchObject({ from: '2026-11-01T00:00:00Z', to: '2026-12-01T00:00:00Z', count: 2 });
    expect(query(result.requests[0]!)).toMatchObject({ from: '2026-11-01T00:00:00Z', to: '2026-12-01T00:00:00Z' });
  });

  it('accepts exactly 31 days and rejects more, before any request', async () => {
    const harness = await open();
    expect((await harness.call('find_games', { league: 'nfl', from: '2026-11-01T00:00:00Z', to: '2026-12-02T00:00:00Z' })).isError).toBe(false);
    const tooLong = await harness.call('find_games', { league: 'nfl', from: '2026-11-01T00:00:00Z', to: '2026-12-02T00:00:01Z' });
    expect(tooLong.isError).toBe(true);
    expect(tooLong.text).toContain('31 days');
    expect(tooLong.requests).toHaveLength(0);
  });

  it('rejects to before from, and from without to', async () => {
    const harness = await open();
    expect((await harness.call('find_games', { league: 'nfl', from: '2026-11-02T00:00:00Z', to: '2026-11-01T00:00:00Z' })).text).toContain('after from');
    expect((await harness.call('find_games', { league: 'nfl', from: '2026-11-02T00:00:00Z' })).isError).toBe(true);
  });
});

describe('find_games argument rules', () => {
  it.each([
    ['nothing', {}],
    ['date and live', { date: 'today', live: true }],
    ['date and a range', { date: 'today', from: '2026-11-01T00:00:00Z', to: '2026-11-02T00:00:00Z' }],
  ])('rejects %s', async (_name, args) => {
    const result = await (await open()).call('find_games', { league: 'nfl', ...args });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('exactly one');
  });

  it('requires league', async () => {
    const result = await (await open()).call('find_games', { date: 'today' });
    expect(result.isError).toBe(true);
    expect(result.requests).toHaveLength(0);
  });
});

describe('find_games team', () => {
  const now = new Date('2026-11-10T03:00:00Z');

  it('resolves a team name with one extra request', async () => {
    const result = await (await open({ now })).call('find_games', { league: 'nfl', date: 'today', team: 'Bills' });
    expect(result.json.team).toEqual({ id: BILLS, alias: 'BUF', name: 'Buffalo Bills' });
    expect(result.json.games).toHaveLength(1);
    expect(result.requests.map((r) => new URL(r.url).pathname)).toEqual(['/v1/nfl/teams', '/v1/nfl/games']);
    expect(query(result.requests[1]!).team_id).toBe(BILLS);
  });

  it('passes a team id straight through', async () => {
    const result = await (await open({ now })).call('find_games', { league: 'nfl', date: 'today', team: BILLS });
    expect(result.requests).toHaveLength(1);
    expect(result.json.team).toEqual({ id: BILLS, alias: 'BUF', name: 'Buffalo Bills' });
  });

  it('stays within three requests for live mode with a team name', async () => {
    const result = await (await open({ now })).call('find_games', { league: 'nfl', live: true, team: 'vikings' });
    expect(result.isError).toBe(false);
    expect(result.requests).toHaveLength(3);
  });

  it('asks which team when a name matches several', async () => {
    const team = fixture<{ teams: Record<string, unknown>[] }>('openapi/listGames.json').teams[0]!;
    const teams = [
      { ...team, id: '01a1b987-0000-7000-8000-000000000001', alias: 'MNC', market: 'Manchester City', name: 'Manchester City', league: 'epl' },
      { ...team, id: '01a1b987-0000-7000-8000-000000000002', alias: 'MAN', market: 'Manchester United', name: 'Manchester United', league: 'epl' },
    ];
    const result = await (await open({ now, teams: { epl: teams as never } })).call('find_games', { league: 'epl', date: 'today', team: 'Manchester' });
    expect(result.isError).toBe(true);
    expect(result.json.error).toBe('invalid_argument');
    expect(result.json.candidates.map((c: { alias: string }) => c.alias)).toEqual(['MNC', 'MAN']);
    expect(result.requests).toHaveLength(1);
  });

  it('says when no team matches', async () => {
    const result = await (await open({ now })).call('find_games', { league: 'nfl', date: 'today', team: 'Packers' });
    expect(result.isError).toBe(true);
    expect(result.json.message).toContain('find_teams');
  });
});
