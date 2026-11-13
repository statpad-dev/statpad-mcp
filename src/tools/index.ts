import type { Tool } from './common.js';
import { findGames } from './find-games.js';
import { findTeams } from './find-teams.js';
import { getBoxScore } from './get-box-score.js';
import { getGameTool } from './get-game.js';
import { getPlays } from './get-plays.js';
import { listLeagues } from './list-leagues.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TOOLS: readonly Tool<any, any>[] = [listLeagues, findTeams, findGames, getGameTool, getBoxScore, getPlays];
