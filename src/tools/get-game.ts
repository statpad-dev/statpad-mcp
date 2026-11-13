import * as z from 'zod/v4';

import { dropNulls } from '../output.js';
import {
  defineTool,
  gameIdArg,
  gameTeams,
  getGame,
  leagueArg,
  liveStateSchema,
  liveStateView,
  outputSchema,
  seqSchema,
  teamRefSchema,
} from './common.js';

export const getGameTool = defineTool({
  name: 'get_game',
  title: 'Get a game',
  description:
    "Get one game's status, score and live situation: period, clock, possession and the sport's details, such as down and distance in football or the minute and red cards in soccer. live_state.updated_at says how fresh it is. Also returns the teams, the venue and seq, the game's change-stream position, which get_plays takes as after_seq. started_at and ended_at aren't filled yet, so use status. Score by period is left out until Statpad fills it.",
  input: z.object({ league: leagueArg, game_id: gameIdArg }),
  output: outputSchema({
    league: z.string(),
    game_id: z.string(),
    status: z.string(),
    scheduled_at: z.string(),
    title: z.string().optional(),
    game_type: z.string(),
    neutral_site: z.boolean(),
    away: teamRefSchema,
    home: teamRefSchema,
    away_score: z.number().optional(),
    home_score: z.number().optional(),
    venue: z.object({ name: z.string(), city: z.string().optional(), state: z.string().optional(), country: z.string().optional() }).optional(),
    live_state: liveStateSchema.optional(),
    period_scores: z
      .array(z.object({ team: z.string(), period: z.number(), period_type: z.string(), points: z.number() }))
      .optional(),
    seq: seqSchema,
  }),
  async run({ league, game_id }, ctx) {
    const detail = await getGame(ctx, league, game_id);
    const { game, venue } = detail;
    const { index, away, home } = gameTeams(detail);
    return dropNulls({
      league,
      game_id,
      status: game.status,
      scheduled_at: game.scheduled_at,
      title: game.title ?? undefined,
      game_type: game.game_type,
      neutral_site: game.neutral_site,
      away,
      home,
      away_score: game.away_score ?? undefined,
      home_score: game.home_score ?? undefined,
      venue: venue
        ? dropNulls({ name: venue.name, city: venue.city ?? undefined, state: venue.state ?? undefined, country: venue.country ?? undefined })
        : undefined,
      live_state: detail.live_state ? liveStateView(detail.live_state, index) : undefined,
      period_scores:
        detail.period_scores.length > 0
          ? detail.period_scores.map((score) => ({
              team: index.name(score.team_id) ?? score.team_id,
              period: score.period,
              period_type: score.period_type,
              points: score.points,
            }))
          : undefined,
      seq: detail.seq,
    });
  },
});
