import { type ChangeList, type GameDetail, type LiveState, type Play, type PlayGroup, StatpadError } from '@statpad/sdk';
import * as z from 'zod/v4';

import type { CallContext } from '../context.js';
import { fitCount, MAX_TOKENS, TARGET_TOKENS } from '../output.js';
import type { TeamIndex } from '../teams.js';
import { formatClock } from '../time.js';
import {
  defineTool,
  gameIdArg,
  gameTeams,
  getGame,
  leagueArg,
  liveStateSchema,
  liveStateView,
  outputSchema,
  playSchema,
  type PlayView,
  playView,
  seqSchema,
  teamRefSchema,
} from './common.js';

/** listPlays' largest page. After the game read, two pages fit the request budget. */
const PLAYS_PAGE = 1_000;
const CHANGES_PAGE = 500;
const MAX_LIMIT = 50;

const driveSchema = z.object({
  kind: z.string().describe('drive, at_bat or possession.'),
  period: z.number(),
  team: z.string().optional(),
  result: z.string().optional(),
  plays: z.number().optional(),
  yards: z.number().optional(),
  first_downs: z.number().optional(),
  points: z.number().optional(),
  duration: z.string().optional().describe('Time of possession, M:SS.'),
  start_clock: z.string().optional(),
  start_yardline: z.number().optional().describe("0-100 from the offense's own goal line."),
  end_yardline: z.number().optional(),
});

const input = z
  .object({
    league: leagueArg,
    game_id: gameIdArg,
    mode: z
      .enum(['recent', 'scoring', 'drives'])
      .default('recent')
      .describe('recent: the last plays. scoring: scoring plays only. drives: drives or at-bats with their result.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_LIMIT)
      .optional()
      .describe('How many plays or drives to return, newest last. Default 10 recent plays, up to 50 scoring plays, and every drive.'),
    after_seq: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Only what changed after this seq, from an earlier result. Works with recent and scoring.'),
  })
  .superRefine((args, issues) => {
    if (args.mode === 'drives' && args.after_seq !== undefined) {
      issues.addIssue({ code: 'custom', path: ['after_seq'], message: 'after_seq works with mode recent or scoring, not drives.' });
    }
  });

type Args = z.output<typeof input>;

const output = outputSchema({
  league: z.string(),
  game_id: z.string(),
  mode: z.string(),
  status: z.string(),
  away: teamRefSchema,
  home: teamRefSchema,
  away_score: z.number().optional(),
  home_score: z.number().optional(),
  total_plays: z.number().optional().describe('Plays read from the game.'),
  count: z.number().optional().describe('How many plays or drives matched, before limit and trimming.'),
  plays: z.array(playSchema).optional(),
  drives: z.array(driveSchema).optional(),
  after_seq: z.number().optional(),
  head_seq: z.number().optional().describe("The stream's latest seq."),
  caught_up: z.boolean().optional().describe('True when seq has reached head_seq.'),
  resync_required: z.boolean().optional(),
  live_state: liveStateSchema.optional(),
  seq: seqSchema,
});

type Output = z.output<typeof output>;

export const getPlays = defineTool({
  name: 'get_plays',
  title: 'Get plays',
  description:
    "Get a game's play-by-play. mode recent returns the last plays, 10 by default; scoring returns the scoring plays, up to 50; drives returns drives or at-bats with team, result, yards, points and time of possession. Each play has the period, clock, team, description and the score after it. In NFL and NCAAF the description names the players. Every result has seq. To follow a live game, pass that seq back as after_seq to get only the plays and live-state changes since, then pass the new seq on the next call. If the stream no longer holds after_seq, the result has resync_required and a fresh seq from a new game read.",
  input,
  output,
  async run(args, ctx) {
    if (args.after_seq !== undefined) return changesSince(args, args.after_seq, ctx);
    if (args.mode === 'drives') return drives(args, ctx);
    return plays(args, ctx);
  },
});

function header(args: Args, detail: GameDetail) {
  const { away, home } = gameTeams(detail);
  return {
    league: args.league,
    game_id: args.game_id,
    mode: args.mode,
    status: detail.game.status,
    away,
    home,
    away_score: detail.game.away_score ?? undefined,
    home_score: detail.game.home_score ?? undefined,
  };
}

async function plays(args: Args, ctx: CallContext): Promise<Output> {
  const path = { league: args.league, game_id: args.game_id };
  const page = (cursor?: string) =>
    ctx
      .request((signal) => ctx.statpad.playByPlay.listPlays({ path, query: { limit: PLAYS_PAGE, ...(cursor ? { cursor } : {}) }, signal }))
      .then((r) => r.data);
  const [detail, first] = await Promise.all([getGame(ctx, args.league, args.game_id), page()]);
  let all = first.data;
  let cursor = first.next_cursor;
  if (cursor !== null) {
    const second = await page(cursor);
    all = all.concat(second.data);
    cursor = second.next_cursor;
  }

  const { index } = gameTeams(detail);
  const selected = args.mode === 'scoring' ? all.filter((play) => play.is_scoring) : all;
  const limit = args.limit ?? (args.mode === 'scoring' ? MAX_LIMIT : 10);
  const views = selected.slice(-limit).map((play) => playView(play, index));
  const base = { ...header(args, detail), total_plays: all.length, count: selected.length, seq: first.seq };
  const build = (count: number) => ({ ...base, plays: views.slice(views.length - count) });
  const kept = fitCount(views.length, args.limit === undefined ? TARGET_TOKENS : MAX_TOKENS, build);
  const result: Output = build(kept);

  if (cursor !== null) {
    return {
      ...result,
      truncated: true,
      note: `This game has more than ${2 * PLAYS_PAGE} plays, and one call can read only the first ${2 * PLAYS_PAGE}, so these are not the latest plays. Use after_seq with the seq of a get_game result to follow the game from now on.`,
    };
  }
  if (kept < views.length) {
    return { ...result, truncated: true, hint: `Showing the last ${kept} plays to fit the response size. Ask for a smaller limit.` };
  }
  if (views.length < selected.length) {
    return { ...result, hint: `Showing the last ${views.length} of ${selected.length} plays. Raise limit, up to ${MAX_LIMIT}, for more.` };
  }
  return result;
}

async function drives(args: Args, ctx: CallContext): Promise<Output> {
  const path = { league: args.league, game_id: args.game_id };
  const [detail, groups] = await Promise.all([
    getGame(ctx, args.league, args.game_id),
    ctx.request((signal) => ctx.statpad.playByPlay.listPlayGroups({ path, query: { limit: 500 }, signal })).then((r) => r.data),
  ]);
  const { index } = gameTeams(detail);
  const views = groups.data.slice(-(args.limit ?? groups.data.length)).map((group) => driveView(group, index));
  const base = { ...header(args, detail), count: groups.data.length, seq: groups.seq };
  const build = (count: number) => ({ ...base, drives: views.slice(views.length - count) });
  const kept = fitCount(views.length, args.limit === undefined ? TARGET_TOKENS : MAX_TOKENS, build);
  const result: Output = build(kept);

  if (groups.data.length === 0) {
    return {
      ...result,
      note: 'This game has no drives or at-bats yet. Soccer events belong to no group, so use mode recent or scoring for a soccer match.',
    };
  }
  if (kept < views.length || groups.next_cursor !== null) {
    return { ...result, truncated: true, hint: `Showing the last ${kept} drives. Pass a limit for fewer.` };
  }
  return result;
}

function driveView(group: PlayGroup, teams: TeamIndex): z.output<typeof driveSchema> {
  const drive = group.football;
  const clock = (seconds: number | null | undefined) => (seconds === null || seconds === undefined ? undefined : formatClock(seconds));
  return {
    kind: group.kind,
    period: group.period,
    team: teams.name(group.team_id),
    result: group.result ?? undefined,
    plays: drive?.play_count ?? undefined,
    yards: drive?.yards ?? undefined,
    first_downs: drive?.first_downs ?? undefined,
    points: drive?.points ?? undefined,
    duration: clock(drive?.duration_seconds),
    start_clock: clock(drive?.start_clock),
    start_yardline: drive?.start_yardline ?? undefined,
    end_yardline: drive?.end_yardline ?? undefined,
  };
}

const RESYNC = Symbol('resync');

async function changesSince(args: Args, afterSeq: number, ctx: CallContext): Promise<Output> {
  const path = { league: args.league, game_id: args.game_id };
  const [detail, changes] = await Promise.all([
    getGame(ctx, args.league, args.game_id),
    ctx
      .request((signal) => ctx.statpad.changes.listGameChanges({ path, query: { after_seq: afterSeq, limit: CHANGES_PAGE }, signal }))
      .then(
        (r) => r.data,
        (error: unknown) => {
          if (error instanceof StatpadError && error.code === 'resync_required') return { resync: RESYNC, minSeq: error.minSeq } as const;
          throw error;
        },
      ),
  ]);
  const { index } = gameTeams(detail);

  if ('resync' in changes) {
    return {
      ...header(args, detail),
      after_seq: afterSeq,
      resync_required: true,
      live_state: detail.live_state ? liveStateView(detail.live_state, index) : undefined,
      plays: [],
      seq: detail.seq,
      note: `The change stream no longer holds after_seq ${afterSeq}${changes.minSeq === undefined ? '' : `, because its history now starts at ${changes.minSeq}`}. This result is a fresh read of the game instead. Resync: treat what you held as stale, and continue with after_seq set to this seq.`,
    };
  }

  const limit = args.limit ?? 10;
  const build = (maxPlays: number) => {
    const collected = collect(changes, afterSeq, maxPlays, args.mode === 'scoring', index);
    return {
      ...header(args, detail),
      after_seq: afterSeq,
      head_seq: changes.head_seq,
      caught_up: collected.seq >= changes.head_seq,
      plays: collected.plays,
      live_state: collected.liveState ? liveStateView(collected.liveState, index) : undefined,
      seq: collected.seq,
    };
  };
  const kept = fitCount(limit, args.limit === undefined ? TARGET_TOKENS : MAX_TOKENS, build);
  const result: Output = build(kept);
  if (!result.caught_up) {
    return {
      ...result,
      ...(kept < limit ? { truncated: true } : {}),
      hint: `More changes follow. Call again with after_seq ${result.seq}.`,
    };
  }
  return result;
}

/**
 * Walks the changes in seq order and keeps the play changes and the latest live state, up to
 * maxPlays plays. seq is the last change walked, so the next call resumes right after it and
 * never skips a play that didn't fit.
 */
function collect(changes: ChangeList, afterSeq: number, maxPlays: number, scoringOnly: boolean, teams: TeamIndex) {
  const plays: PlayView[] = [];
  let liveState: LiveState | undefined;
  let seq = afterSeq;
  for (const change of changes.data) {
    if (change.entity_type === 'play') {
      if (change.op === 'delete') {
        if (plays.length >= maxPlays) break;
        plays.push({ op: 'delete', id: change.entity_id });
      } else {
        const play = change.payload as Play;
        if (!scoringOnly || play.is_scoring) {
          if (plays.length >= maxPlays) break;
          plays.push({ op: 'upsert', id: play.id, ...playView(play, teams) });
        }
      }
    } else if (change.entity_type === 'live_state' && change.op === 'upsert') {
      liveState = change.payload as LiveState;
    }
    seq = change.seq;
  }
  return { plays, liveState, seq };
}
