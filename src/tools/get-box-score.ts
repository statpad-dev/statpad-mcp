import type { PlayerGameStats, StatLine } from '@statpad/sdk';
import * as z from 'zod/v4';

import { ToolInputError } from '../context.js';
import { fitCount, MAX_TOKENS, TARGET_TOKENS } from '../output.js';
import { fold } from '../text.js';
import { defineTool, gameIdArg, gameTeams, getGame, leagueArg, outputSchema, seqSchema, statLineSchema, teamRefSchema } from './common.js';

/** The stat that ranks a category's lines in the summary, best first. */
const RANK_BY: Record<string, string[]> = {
  passing: ['yards', 'touchdowns'],
  rushing: ['yards', 'touchdowns'],
  receiving: ['yards', 'receptions'],
  defensive: ['tackles', 'sacks'],
  interceptions: ['interceptions', 'yards'],
  fumbles: ['fumbles', 'lost'],
  kicking: ['points', 'field_goals_made'],
  punting: ['punts', 'yards'],
  kick_returns: ['yards', 'returns'],
  punt_returns: ['yards', 'returns'],
  soccer: ['total_goals', 'goal_assists', 'saves', 'shots_on_target', 'total_shots'],
};

const KNOWN_CATEGORIES = Object.keys(RANK_BY);

const lineSchema = z.object({
  player: z.string(),
  player_id: z.string(),
  team: z.string().describe('Team abbreviation.'),
  jersey: z.string().optional(),
  position: z.string().optional(),
  stats: statLineSchema,
});

interface Line extends z.output<typeof lineSchema> {
  category: string;
}

export const getBoxScore = defineTool({
  name: 'get_box_score',
  title: 'Get a box score',
  description: `Get the player stat lines of one game, grouped by stat category, with player names and teams. Filter with team, an id or abbreviation; player, part of a name, ignoring accents; and category, such as ${KNOWN_CATEGORIES.join(', ')}. With no filter on a big game it returns the top lines of each category, sets truncated and says how to see the rest. Statpad doesn't fill team totals or score by period yet. For a team total, add up that team's player lines for the category, and say the total is summed from player lines.`,
  input: z.object({
    league: leagueArg,
    game_id: gameIdArg,
    team: z.string().min(1).max(100).optional().describe('Only this team: its id or abbreviation, such as BUF.'),
    player: z.string().min(1).max(100).optional().describe('Only players whose name contains this, such as "allen".'),
    category: z
      .string()
      .regex(/^[a-z_]+$/)
      .optional()
      .describe(`Only this stat category, such as ${KNOWN_CATEGORIES.join(', ')}.`),
  }),
  output: outputSchema({
    league: z.string(),
    game_id: z.string(),
    status: z.string(),
    away: teamRefSchema,
    home: teamRefSchema,
    filters: z.object({ team: z.string().optional(), player: z.string().optional(), category: z.string().optional() }).optional(),
    lines: z.number().describe('How many player lines matched, before any trimming.'),
    categories: z.record(z.string(), z.array(lineSchema)),
    seq: seqSchema,
  }),
  async run({ league, game_id, team, player, category }, ctx) {
    const path = { league, game_id };
    const [detail, box, roster] = await Promise.all([
      getGame(ctx, league, game_id),
      ctx.request((signal) => ctx.statpad.statistics.getBoxScore({ path, signal })).then((r) => r.data),
      ctx.request((signal) => ctx.statpad.games.listGameRoster({ path, query: { limit: 500 }, signal })).then((r) => r.data),
    ]);
    const { index, away, home } = gameTeams(detail);
    const names = new Map(roster.players.map((p) => [p.id, p.full_name]));
    const entries = new Map(roster.data.map((entry) => [entry.player_id, entry]));

    let teamId: string | undefined;
    if (team !== undefined) {
      const wanted = fold(team);
      const match = [away, home].find((t) => t.id === team || fold(t.alias) === wanted || fold(t.name) === wanted);
      if (!match) {
        throw new ToolInputError(`"${team}" isn't in this game. The teams are ${away.alias} (${away.name}) and ${home.alias} (${home.name}).`);
      }
      teamId = match.id;
    }

    const all = box.players.flatMap((stats) => linesOf(stats, names, entries, index.alias.bind(index)));
    const lines = all.filter(
      (line) =>
        (teamId === undefined || index.get(teamId)?.alias === line.team) &&
        (player === undefined || fold(line.player).includes(fold(player))) &&
        (category === undefined || line.category === category),
    );
    const filtered = team !== undefined || player !== undefined || category !== undefined;
    const base = {
      league,
      game_id,
      status: detail.game.status,
      away,
      home,
      filters: filtered ? { team, player, category } : undefined,
      lines: lines.length,
      seq: box.seq,
    };

    const grouped = groupByCategory(lines);
    const longest = Math.max(0, ...Object.values(grouped).map((group) => group.length));
    const build = (perCategory: number) => ({ ...base, categories: topLines(grouped, perCategory) });
    const kept = fitCount(longest, filtered ? MAX_TOKENS : TARGET_TOKENS, build);
    const result = build(kept);

    if (lines.length === 0) {
      const present = [...new Set(all.map((line) => line.category))].join(', ');
      return { ...result, note: `No player line matched the filters. This game has these categories: ${present || 'none yet'}.` };
    }
    if (kept < longest) {
      return {
        ...result,
        truncated: true,
        hint: `Showing the top ${kept} lines of each category. Filter by team, player or category to see every line.`,
      };
    }
    return result;
  },
});

function linesOf(
  stats: PlayerGameStats,
  names: Map<string, string>,
  entries: Map<string, { jersey: string | null; position: string | null }>,
  alias: (id: string) => string | undefined,
): Line[] {
  const entry = entries.get(stats.player_id);
  return Object.entries(stats.stats).map(([category, line]) => ({
    category,
    player: names.get(stats.player_id) ?? stats.player_id,
    player_id: stats.player_id,
    team: alias(stats.team_id) ?? stats.team_id,
    jersey: entry?.jersey ?? undefined,
    position: entry?.position ?? undefined,
    stats: line,
  }));
}

function groupByCategory(lines: Line[]): Record<string, Line[]> {
  const order = (category: string) => {
    const at = KNOWN_CATEGORIES.indexOf(category);
    return at < 0 ? KNOWN_CATEGORIES.length : at;
  };
  const groups: Record<string, Line[]> = {};
  for (const line of [...lines].sort((a, b) => order(a.category) - order(b.category))) (groups[line.category] ??= []).push(line);
  for (const [category, group] of Object.entries(groups)) group.sort((a, b) => compareLines(category, a.stats, b.stats));
  return groups;
}

function compareLines(category: string, a: StatLine, b: StatLine): number {
  for (const key of RANK_BY[category] ?? []) {
    const diff = numeric(b[key]) - numeric(a[key]);
    if (diff !== 0) return diff;
  }
  return total(b) - total(a);
}

function numeric(value: number | string | undefined): number {
  return typeof value === 'number' ? value : 0;
}

function total(line: StatLine): number {
  return Object.values(line).reduce<number>((sum, value) => sum + numeric(value), 0);
}

function topLines(groups: Record<string, Line[]>, count: number): Record<string, z.output<typeof lineSchema>[]> {
  return Object.fromEntries(
    Object.entries(groups).map(([category, group]) => [category, group.slice(0, count).map(({ category: _, ...line }) => line)]),
  );
}
