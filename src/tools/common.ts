import type { GameDetail, LiveState, Play, Team } from '@statpad/sdk';
import * as z from 'zod/v4';

import type { CallContext } from '../context.js';
import { dropNulls } from '../output.js';
import { TeamIndex, type TeamRef, teamRef } from '../teams.js';
import { formatClock } from '../time.js';

export interface Tool<I extends z.ZodObject = z.ZodObject, O extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  input: I;
  output: O;
  run(args: z.output<I>, ctx: CallContext): Promise<z.output<O>>;
}

export function defineTool<I extends z.ZodObject, O extends z.ZodObject>(tool: Tool<I, O>): Tool<I, O> {
  return tool;
}

export const leagueArg = z
  .string()
  .regex(/^[a-z][a-z0-9]*$/, 'A league alias is lowercase letters and digits, such as nfl.')
  .describe('League alias, such as nfl, ncaaf or epl. list_leagues returns the leagues this key can read.');

export const gameIdArg = z.guid().describe('Game id, from find_games.');

export const teamRefSchema = z.object({ id: z.string(), alias: z.string(), name: z.string() });

/** A number or a string, as anyOf so single-type schema dialects can read it. */
const scalar = z.union([z.number(), z.string().describe('A value Statpad defines as text.')]);

export const statLineSchema = z.record(z.string(), scalar);

export const seqSchema = z
  .number()
  .int()
  .describe("The game's change-stream position this result reflects. Pass it to get_plays as after_seq for what changed since.");

/** Every output shares these optional fields. */
export function outputSchema<S extends z.ZodRawShape>(shape: S) {
  return z.object({
    ...shape,
    truncated: z.boolean().optional().describe('True when the result was trimmed to fit the response size budget.'),
    hint: z.string().optional().describe('How to get what the trimmed result left out.'),
    note: z.string().optional(),
    warning: z.string().optional().describe("Set when the account's request allowance is nearly used up."),
  });
}

export const liveStateSchema = z.object({
  period: z.number().optional(),
  period_half: z.string().optional(),
  clock: z.string().optional().describe('Time left in the period, M:SS.'),
  possession: z.string().optional(),
  away_score: z.number().optional(),
  home_score: z.number().optional(),
  clock_running: z.boolean().optional(),
  football: z.record(z.string(), scalar).optional().describe('Down, distance, yard line and timeouts.'),
  soccer: z.record(z.string(), scalar).optional().describe('Minute, stoppage time, formations, red cards and shoot-out score.'),
  basketball: z.record(z.string(), scalar).optional().describe('Timeouts and fouls.'),
  updated_at: z.string().describe('When Statpad last updated the live state. Quote it as the freshness of the data.'),
});

export const playSchema = z.object({
  id: z.string().optional(),
  op: z.enum(['upsert', 'delete']).optional(),
  period: z.number().optional(),
  clock: z.string().optional(),
  team: z.string().optional(),
  type: z.string().optional(),
  description: z.string().optional(),
  away_score: z.number().optional(),
  home_score: z.number().optional(),
  points: z.number().optional(),
});

export type PlayView = z.output<typeof playSchema>;

/** The teams of a game, from its detail read. */
export function gameTeams(detail: GameDetail): { index: TeamIndex; away: TeamRef; home: TeamRef } {
  return {
    index: new TeamIndex([detail.away_team, detail.home_team]),
    away: teamRef(detail.away_team),
    home: teamRef(detail.home_team),
  };
}

export async function getGame(ctx: CallContext, league: string, gameId: string): Promise<GameDetail> {
  const { data } = await ctx.request((signal) => ctx.statpad.games.getGame({ path: { league, game_id: gameId }, signal }));
  return data;
}

/** One page of the league's teams, up to 500, which covers every league Statpad serves. */
export async function listTeams(ctx: CallContext, league: string): Promise<{ teams: Team[]; complete: boolean }> {
  const { data } = await ctx.request((signal) => ctx.statpad.teams.listTeams({ path: { league }, query: { limit: 500 }, signal }));
  return { teams: data.data, complete: data.next_cursor === null };
}

export function liveStateView(state: LiveState, teams: TeamIndex): z.output<typeof liveStateSchema> {
  return dropNulls({
    period: state.period ?? undefined,
    period_half: state.period_half ?? undefined,
    clock: state.clock_seconds === null ? undefined : formatClock(state.clock_seconds),
    possession: teams.name(state.possession_team_id),
    away_score: state.away_score,
    home_score: state.home_score,
    clock_running: state.clock_running || undefined,
    football: situation(state.football),
    soccer: situation(state.soccer),
    basketball: situation(state.basketball),
    updated_at: state.updated_at,
  });
}

function situation(block: object | null): Record<string, number | string> | undefined {
  return block ? (dropNulls(block) as Record<string, number | string>) : undefined;
}

/** A play as the model reads it: when, who, what, and the score after it. */
export function playView(play: Play, teams: TeamIndex): PlayView {
  return dropNulls({
    period: play.period,
    clock: playClock(play),
    team: teams.name(play.team_id),
    type: play.type,
    description: play.description ?? undefined,
    away_score: play.away_score ?? undefined,
    home_score: play.home_score ?? undefined,
    points: play.is_scoring ? (play.points ?? undefined) : undefined,
  });
}

function playClock(play: Play): string | undefined {
  if (play.soccer) {
    const { minute, added_minute: added } = play.soccer;
    if (minute === null) return undefined;
    return added ? `${minute}+${added}'` : `${minute}'`;
  }
  return play.clock_seconds === null ? undefined : formatClock(play.clock_seconds);
}
