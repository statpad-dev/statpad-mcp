import { readFileSync } from 'node:fs';

import type { Change, Game, GameDetail, Play, Team } from '@statpad/sdk';

import { localParts } from '../../src/time.js';

export const TEST_KEY = 'sporty_AbCdEfGhIjKlMnOp.QRSTUVWXYZabcdefghijklmnopqrstuvwxyz012345w';

export const NFL_GAME = '01a1cca4-3e00-7e94-bcef-b47bbed025f0';
export const EPL_GAME = '01a1cca4-bb93-77d8-8fd9-e865faca45b5';
export const NCAAF_GAME = '01a1b987-64e7-74e3-8db1-b939d352190d';
export const JAX_AT_BAL = '01a1b987-644f-7459-b8e0-810b314f71da';
export const BILLS = '01a1cca4-3e05-7c90-a80f-05893446d191';

export function fixture<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(new URL(`../fixtures/${path}`, import.meta.url), 'utf8')) as T;
}

interface Sample {
  dir: string;
  league: string;
}

const SAMPLES: Record<string, Sample> = {
  [NFL_GAME]: { dir: 'nfl-bills-at-vikings', league: 'nfl' },
  [EPL_GAME]: { dir: 'epl-man-utd-aston-villa', league: 'epl' },
};

const LIVE_LEAGUES = new Set(['nfl', 'ncaaf', 'epl']);

/** The game reads the stub serves: the two samples and the getGame example from api/openapi.yaml. */
function gameDetails(live: boolean): Map<string, GameDetail> {
  const details = new Map<string, GameDetail>();
  details.set(NFL_GAME, fixture<GameDetail>(`nfl-bills-at-vikings/${live ? 'game-live' : 'game'}.json`));
  details.set(EPL_GAME, fixture<GameDetail>('epl-man-utd-aston-villa/game.json'));
  details.set(NCAAF_GAME, fixture<GameDetail>('openapi/getGame.json'));
  return details;
}

/**
 * The schedule and team list per league. Statpad publishes no samples of listGames or
 * listTeams, so these come from the listGames, listTeams and getGame examples in
 * api/openapi.yaml, joined with the games and teams of the samples. See fixtures/README.md.
 */
function leagueData(details: Map<string, GameDetail>): Record<string, { games: Game[]; teams: Team[] }> {
  const listGames = fixture<{ data: Game[]; teams: Team[] }>('openapi/listGames.json');
  const listTeams = fixture<{ data: Team[] }>('openapi/listTeams.json');
  const nfl = details.get(NFL_GAME)!;
  const epl = details.get(EPL_GAME)!;
  const ncaaf = details.get(NCAAF_GAME)!;
  const byMarket = (a: Team, b: Team) => a.market.localeCompare(b.market) || a.name.localeCompare(b.name);
  const unique = (teams: Team[]) => [...new Map(teams.map((team) => [team.id, team])).values()].sort(byMarket);
  return {
    nfl: { games: [...listGames.data, nfl.game], teams: unique([...listTeams.data, ...listGames.teams, nfl.away_team, nfl.home_team]) },
    ncaaf: { games: [ncaaf.game], teams: unique([ncaaf.away_team, ncaaf.home_team]) },
    epl: { games: [epl.game], teams: unique([epl.away_team, epl.home_team]) },
  };
}

export interface StubOptions {
  /** Serve the in-progress read of the NFL sample, game-live.json, instead of the final one. */
  live?: boolean;
  /** Requests left in the period, for the RateLimit header. */
  remaining?: number;
  /** The oldest seq the NFL change stream still holds. */
  minSeq?: number;
  /** Replaces a league's teams. */
  teams?: Record<string, Team[]>;
  /** Replaces the NFL sample's plays. */
  plays?: Play[];
  /** Answers instead of the router when it returns a response. */
  override?: (url: URL, request: Request) => Response | Promise<Response> | undefined;
}

export interface Stub {
  fetch: typeof fetch;
  requests: Request[];
}

export function createStub(options: StubOptions = {}): Stub {
  const details = gameDetails(options.live ?? false);
  const leagues = leagueData(details);
  for (const [league, teams] of Object.entries(options.teams ?? {})) leagues[league] = { games: leagues[league]?.games ?? [], teams };
  const requests: Request[] = [];

  const fetchStub = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    requests.push(request);
    const url = new URL(request.url);
    const overridden = await options.override?.(url, request);
    if (overridden) return overridden;
    if (request.headers.get('Authorization') !== `Bearer ${TEST_KEY}`) {
      return problem(401, 'unauthorized', 'The API key is missing, unknown or revoked.', {}, { 'WWW-Authenticate': 'Bearer error="invalid_token"' });
    }
    return withLimits(route(url, request), options.remaining ?? 499_120);
  };

  function route(url: URL, _request: Request): Response {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'v1') return problem(404, 'not_found', 'No such endpoint.');
    if (parts.length === 2 && parts[1] === 'leagues') return json(fixture('leagues.json'));
    const league = parts[1]!;
    if (!LIVE_LEAGUES.has(league)) return problem(403, 'forbidden', `The plan does not include ${league}.`);
    const data = leagues[league]!;
    const resource = parts[2];

    if (resource === 'teams' && parts.length === 3) return json({ data: data.teams, next_cursor: null });
    if (resource !== 'games') return problem(404, 'not_found', 'No such endpoint.');
    if (parts.length === 3) return listGames(url, data.games, data.teams);

    const gameId = parts[3]!;
    const detail = details.get(gameId);
    if (!detail || detail.game.league !== league) return problem(404, 'not_found', `No game ${gameId} in ${league}.`);
    const sample = SAMPLES[gameId];
    switch (parts[4]) {
      case undefined:
        return json(detail);
      case 'plays':
        return listPlays(url, sample, options.plays);
      case 'play-groups':
        return sample?.league === 'nfl' ? json(fixture(`${sample.dir}/play-groups.json`)) : json({ data: [], next_cursor: null, seq: detail.seq });
      case 'boxscore':
        return sample ? json(fixture(`${sample.dir}/boxscore.json`)) : missing();
      case 'roster':
        return sample ? json(fixture(`${sample.dir}/roster.json`)) : missing();
      case 'changes':
        return listChanges(url, gameId, options.minSeq ?? 1);
      default:
        return problem(404, 'not_found', 'No such endpoint.');
    }
  }

  return { fetch: fetchStub as typeof fetch, requests };
}

function listGames(url: URL, games: Game[], teams: Team[]): Response {
  const query = url.searchParams;
  const date = query.get('date');
  const tz = query.get('tz') ?? 'America/New_York';
  const from = query.get('from');
  const to = query.get('to');
  const teamId = query.get('team_id');
  if (date && (from || to)) return problem(400, 'bad_request', 'Pass date or from and to, not both.');
  const matched = games.filter((game) => {
    if (teamId && game.home_team_id !== teamId && game.away_team_id !== teamId) return false;
    if (date) return localParts(new Date(game.scheduled_at), tz).date === date;
    if (from && to) return game.scheduled_at >= new Date(from).toISOString() && game.scheduled_at < new Date(to).toISOString();
    return true;
  });
  const ids = new Set(matched.flatMap((game) => [game.home_team_id, game.away_team_id]));
  return json({ data: matched, teams: teams.filter((team) => ids.has(team.id)), next_cursor: null });
}

function listPlays(url: URL, sample: Sample | undefined, override: Play[] | undefined): Response {
  if (!sample) return missing();
  const page = fixture<{ data: Play[]; seq: number }>(`${sample.dir}/plays.json`);
  const plays = override ?? page.data;
  const limit = Number(url.searchParams.get('limit') ?? 500);
  const offset = Number(url.searchParams.get('cursor') ?? 0);
  const next = offset + limit < plays.length ? String(offset + limit) : null;
  return json({ data: plays.slice(offset, offset + limit), next_cursor: next, seq: page.seq });
}

function listChanges(url: URL, gameId: string, minSeq: number): Response {
  if (gameId !== NFL_GAME) return json({ stream: `game:${gameId}`, data: [], head_seq: 0, min_seq: 0 });
  const changes = readFileSync(new URL('../fixtures/nfl-bills-at-vikings/changes.ndjson', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Change);
  const head = changes.at(-1)!.seq;
  const afterSeq = Number(url.searchParams.get('after_seq'));
  const limit = Number(url.searchParams.get('limit') ?? 500);
  if (afterSeq > head) return problem(400, 'bad_request', `after_seq ${afterSeq} is beyond the stream's latest change, ${head}.`);
  if (afterSeq < minSeq - 1) {
    return problem(410, 'resync_required', `after_seq ${afterSeq} is older than the retained history. Fetch the game and continue from its seq.`, {
      min_seq: minSeq,
    });
  }
  const data = changes.filter((change) => change.seq > afterSeq).slice(0, limit);
  return json({ stream: `game:${gameId}`, data, head_seq: head, min_seq: minSeq });
}

function missing(): Response {
  return problem(404, 'not_found', 'No data for this game in the fixtures.');
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export function problem(
  status: number,
  code: string,
  detail: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Response {
  const body = {
    type: `https://statpad.dev/docs/errors/${code}`,
    title: code.replace(/_/g, ' '),
    status,
    code,
    detail,
    request_id: 'req_test_0001',
    ...extra,
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/problem+json', 'X-Request-Id': 'req_test_0001', ...headers },
  });
}

function withLimits(response: Response, remaining: number): Response {
  if (response.status === 401) return response;
  const headers = new Headers(response.headers);
  headers.set('RateLimit-Policy', '"allowance";q=500000;w=2592000');
  headers.set('RateLimit', `"allowance";r=${remaining};t=1723456`);
  if (!headers.has('X-Request-Id')) headers.set('X-Request-Id', 'req_test_0001');
  return new Response(response.body, { status: response.status, headers });
}
