import * as z from 'zod/v4';

import { defineTool, outputSchema } from './common.js';

export const listLeagues = defineTool({
  name: 'list_leagues',
  title: 'List leagues',
  description:
    "List the leagues this API key can read, with each league's alias, name, sport and level. Pass the alias as the league argument of the other tools. Statpad covers only the leagues this returns, so a league missing here isn't available.",
  input: z.object({}),
  output: outputSchema({
    leagues: z.array(z.object({ alias: z.string(), name: z.string(), sport: z.string(), level: z.string() })),
  }),
  async run(_args, ctx) {
    const { data } = await ctx.request((signal) => ctx.statpad.leagues.listLeagues({ signal }));
    return { leagues: data.data.map(({ alias, name, sport, level }) => ({ alias, name, sport, level })) };
  },
});
