import type { Game, GameList, Team } from '@statpad/sdk';
import * as z from 'zod/v4';

import { type CallContext, ToolInputError } from '../context.js';
import { fitCount, TARGET_TOKENS } from '../output.js';
import { isExactMatch, rankTeams, TeamIndex, type TeamRef, teamRef } from '../teams.js';
import { DEFAULT_TIME_ZONE, isTimeZone, localParts, resolveDate } from '../time.js';
import { defineTool, leagueArg, listTeams, outputSchema, teamRefSchema } from './common.js';

const MAX_RANGE_DAYS = 31;
const LIVE_STATUSES = new Set<Game['status']>(['inprogress', 'halftime', 'delayed']);
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const datetime = z.string().regex(DATETIME, 'Use an ISO 8601 datetime with a zone, such as 2026-11-08T00:00:00Z.');

const gameRow = z.object({
  id: z.string(),
  status: z.string(),
  scheduled_at: z.string().describe('Start time, UTC.'),
  local_time: z.string().optional().describe('Start time in tz, YYYY-MM-DD HH:MM.'),
  away: z.string(),
  home: z.string(),
  away_score: z.number().optional(),
  home_score: z.number().optional(),
  game_type: z.string(),
  neutral_site: z.boolean(),
  title: z.string().optional(),
});

const input = z
  .object({
    league: leagueArg,
    date: z
      .string()
      .regex(/^(\d{4}-\d{2}-\d{2}|today|yesterday|tomorrow)$/, 'Use YYYY-MM-DD, today, yesterday or tomorrow.')
      .optional()
      .describe('A schedule day in tz: YYYY-MM-DD, today, yesterday or tomorrow.'),
    from: datetime.optional().describe('Range start, an ISO 8601 datetime such as 2026-11-08T00:00:00Z. Inclusive.'),
    to: datetime.optional().describe(`Range end, an ISO 8601 datetime. Exclusive, at most ${MAX_RANGE_DAYS} days after from.`),
    live: z.boolean().optional().describe('true for the games in progress, at halftime or delayed right now.'),
    team: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe('Only games this team plays: a team id from find_teams, or a name such as "Bills", which costs one extra request.'),
    tz: z
      .string()
      .default(DEFAULT_TIME_ZONE)
      .describe('IANA time zone for date, today, yesterday and tomorrow, and for local_time. Default America/New_York.'),
  })
  .superRefine((args, issues) => {
    const modes = [args.date !== undefined, args.from !== undefined || args.to !== undefined, args.live === true].filter(Boolean).length;
    if (modes !== 1) {
      issues.addIssue({ code: 'custom', message: 'Pass exactly one of date, from and to together, or live: true.' });
    }
    if ((args.from === undefined) !== (args.to === undefined)) {
      issues.addIssue({ code: 'custom', path: ['to'], message: 'from and to go together.' });
    }
    for (const key of ['from', 'to'] as const) {
      const value = args[key];
      if (value !== undefined && Number.isNaN(Date.parse(value))) {
        issues.addIssue({ code: 'custom', path: [key], message: `${key} is not a real date and time.` });
      }
    }
    if (args.from !== undefined && args.to !== undefined) {
      const span = Date.parse(args.to) - Date.parse(args.from);
      if (Number.isNaN(span)) return;
      if (!(span > 0)) issues.addIssue({ code: 'custom', path: ['to'], message: 'to must be after from.' });
      else if (span > MAX_RANGE_DAYS * 86_400_000) {
        issues.addIssue({ code: 'custom', path: ['to'], message: `from and to can be at most ${MAX_RANGE_DAYS} days apart.` });
      }
    }
    if (args.date && /^\d/.test(args.date) && Number.isNaN(Date.parse(`${args.date}T00:00:00Z`))) {
      issues.addIssue({ code: 'custom', path: ['date'], message: 'date is not a real calendar day.' });
    }
    if (!isTimeZone(args.tz)) {
      issues.addIssue({ code: 'custom', path: ['tz'], message: 'tz must be an IANA time zone, such as America/New_York or Europe/London.' });
    }
  });

export const findGames = defineTool({
  name: 'find_games',
  title: 'Find games',
  description:
    'List one league\'s games, with ids, status, start time, teams and scores. Pass exactly one of: date, a schedule day in tz as YYYY-MM-DD, today, yesterday or tomorrow; from and to, ISO 8601 datetimes at most 31 days apart; or live: true, which reads yesterday and today in tz and keeps the games in progress, at halftime or delayed, so a game that runs past midnight still shows. team narrows the list to one team. Statpad lists a game about 10 minutes before kickoff, so a day that hasn\'t started yet usually comes back empty, which doesn\'t mean nothing is scheduled.',
  input,
  output: outputSchema({
    league: z.string(),
    tz: z.string(),
    date: z.string().optional().describe('The schedule day read, YYYY-MM-DD in tz.'),
    dates: z.array(z.string()).optional().describe('With live, the two schedule days read.'),
    from: z.string().optional(),
    to: z.string().optional(),
    live: z.boolean().optional(),
    team: teamRefSchema.partial({ alias: true, name: true }).optional(),
    count: z.number().describe('How many games matched, before any trimming.'),
    games: z.array(gameRow),
  }),
  async run(args, ctx) {
    const { league, tz } = args;
    const team = args.team === undefined ? undefined : await resolveTeam(ctx, league, args.team);
    const query = { tz, limit: 500, ...(team ? { team_id: team.id } : {}) };
    const now = ctx.now();
    const listGames = (extra: { date: string } | { from: string; to: string }) =>
      ctx.request((signal) => ctx.statpad.games.listGames({ path: { league }, query: { ...query, ...extra }, signal })).then((r) => r.data);

    let pages: GameList[];
    let echo: { date?: string; dates?: string[]; from?: string; to?: string; live?: boolean };
    let upcoming: boolean;
    if (args.live) {
      const dates = [resolveDate('yesterday', now, tz), resolveDate('today', now, tz)];
      pages = await Promise.all(dates.map((date) => listGames({ date })));
      echo = { live: true, dates };
      upcoming = false;
    } else if (args.date !== undefined) {
      const date = resolveDate(args.date, now, tz);
      pages = [await listGames({ date })];
      echo = { date };
      upcoming = date >= resolveDate('today', now, tz);
    } else {
      const range = { from: args.from!, to: args.to! };
      pages = [await listGames(range)];
      echo = range;
      upcoming = Date.parse(range.to) > now.getTime();
    }

    const teams = new TeamIndex(pages.flatMap((page) => page.teams));
    const seen = new Set<string>();
    const games = pages
      .flatMap((page) => page.data)
      .filter((game) => !seen.has(game.id) && seen.add(game.id))
      .filter((game) => !args.live || LIVE_STATUSES.has(game.status))
      .map((game) => gameView(game, teams, tz));
    const teamEcho = team ? { ...team, ...(teams.get(team.id) ? teamRef(teams.get(team.id)!) : {}) } : undefined;

    const build = (count: number) => ({ league, tz, ...echo, team: teamEcho, count: games.length, games: games.slice(0, count) });
    const kept = fitCount(games.length, TARGET_TOKENS, build);
    const result = build(kept);
    const more = pages.some((page) => page.next_cursor !== null);
    if (kept < games.length || more) {
      return {
        ...result,
        truncated: true,
        hint: `Showing ${kept} of ${more ? 'more than ' : ''}${games.length} games. Pass team, or a shorter from and to range, to narrow the list.`,
      };
    }
    if (games.length === 0) {
      if (args.live) return { ...result, note: 'No game in this league is in progress, at halftime or delayed right now.' };
      if (upcoming) {
        return {
          ...result,
          note: "Statpad lists a game about 10 minutes before kickoff, so an empty list for a day that hasn't finished doesn't mean nothing is scheduled.",
        };
      }
    }
    return result;
  },
});

function gameView(game: Game, teams: TeamIndex, tz: string): z.output<typeof gameRow> {
  const local = localParts(new Date(game.scheduled_at), tz);
  return {
    id: game.id,
    status: game.status,
    scheduled_at: game.scheduled_at,
    local_time: game.status === 'time_tbd' ? undefined : `${local.date} ${local.time}`,
    away: teams.name(game.away_team_id) ?? game.away_team_id,
    home: teams.name(game.home_team_id) ?? game.home_team_id,
    away_score: game.away_score ?? undefined,
    home_score: game.home_score ?? undefined,
    game_type: game.game_type,
    neutral_site: game.neutral_site,
    title: game.title ?? undefined,
  };
}

/** A team id passes through. A name is looked up with one listTeams request. */
async function resolveTeam(ctx: CallContext, league: string, team: string): Promise<{ id: string } & Partial<TeamRef>> {
  if (GUID.test(team)) return { id: team };
  const { teams } = await listTeams(ctx, league);
  const matches = rankTeams(teams, team);
  const exact = matches.filter((candidate) => isExactMatch(candidate, team));
  const chosen: Team | undefined = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : undefined;
  if (chosen) return teamRef(chosen);
  if (matches.length === 0) {
    throw new ToolInputError(`No team in ${league} matches "${team}". Call find_teams to see the league's teams.`);
  }
  throw new ToolInputError(`"${team}" matches more than one team in ${league}. Pass one of these ids as team.`, {
    candidates: matches.slice(0, 10).map(teamRef),
  });
}
