import * as z from 'zod/v4';

import { fitCount, TARGET_TOKENS } from '../output.js';
import { rankTeams } from '../teams.js';
import { defineTool, leagueArg, listTeams, outputSchema } from './common.js';

const teamRow = z.object({ id: z.string(), alias: z.string(), market: z.string(), name: z.string() });

export const findTeams = defineTool({
  name: 'find_teams',
  title: 'Find teams',
  description:
    'Find teams in one league and get their ids. query matches the team name, market, abbreviation, or market and name together, such as "Buffalo Bills", ignoring case and accents. Best matches come first. Without query it lists every team in the league, trimmed to fit. Statpad has every team that has played a game since collection started in November 2026.',
  input: z.object({
    league: leagueArg,
    query: z.string().min(1).max(100).optional().describe('Team name, city, abbreviation, or a mix, such as "vikings", "MIN" or "Minnesota".'),
  }),
  output: outputSchema({
    league: z.string(),
    query: z.string().optional(),
    count: z.number().describe('How many teams matched, before any trimming.'),
    teams: z.array(teamRow),
  }),
  async run({ league, query }, ctx) {
    const { teams, complete } = await listTeams(ctx, league);
    const matched = (query ? rankTeams(teams, query) : teams).map(({ id, alias, market, name }) => ({ id, alias, market, name }));
    const build = (count: number) => ({ league, query, count: matched.length, teams: matched.slice(0, count) });
    const kept = fitCount(matched.length, TARGET_TOKENS, build);
    const result = build(kept);
    if (kept < matched.length) {
      return { ...result, truncated: true, hint: `Showing ${kept} of ${matched.length} teams. Pass a query to narrow the list.` };
    }
    if (query && matched.length === 0) {
      return { ...result, hint: 'No team matched. Try the city or the nickname alone, or omit query to list every team.' };
    }
    if (!complete) return { ...result, note: 'The league has more than 500 teams, and only the first 500 were searched.' };
    return result;
  },
});
