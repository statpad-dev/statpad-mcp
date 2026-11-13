import type { Team } from '@statpad/sdk';

import { fold } from './text.js';

export interface TeamRef {
  id: string;
  alias: string;
  name: string;
}

/** "Buffalo Bills", or just "Manchester United" when the market and name repeat. */
export function displayName(team: Pick<Team, 'market' | 'name'>): string {
  if (!team.market) return team.name;
  const market = fold(team.market);
  const name = fold(team.name);
  return market === name || name.startsWith(market) ? team.name : `${team.market} ${team.name}`;
}

export function teamRef(team: Team): TeamRef {
  return { id: team.id, alias: team.alias, name: displayName(team) };
}

/** Looks up teams by id, for joining the ids on games, plays and stat lines to names. */
export class TeamIndex {
  private readonly byId = new Map<string, Team>();

  constructor(teams: Iterable<Team>) {
    for (const team of teams) this.byId.set(team.id, team);
  }

  get(id: string | null | undefined): Team | undefined {
    return id ? this.byId.get(id) : undefined;
  }

  name(id: string | null | undefined): string | undefined {
    const team = this.get(id);
    return team ? displayName(team) : undefined;
  }

  alias(id: string | null | undefined): string | undefined {
    return this.get(id)?.alias;
  }
}

/**
 * The teams that match a query, best first: an exact abbreviation or name, then a prefix,
 * then a substring of the name, market, abbreviation or "market name", then every word of
 * the query somewhere in them. Case and accents are ignored.
 */
export function rankTeams<T extends Pick<Team, 'alias' | 'market' | 'name'>>(teams: readonly T[], query: string): T[] {
  const q = fold(query);
  if (!q) return [...teams];
  const words = q.split(' ');
  const scored: { team: T; score: number; index: number }[] = [];
  teams.forEach((team, index) => {
    const fields = [team.alias, team.name, team.market, `${team.market} ${team.name}`, displayName(team)].map(fold);
    const haystack = fields.join(' ');
    let score: number | undefined;
    if (fields.includes(q)) score = 0;
    else if (fields.some((field) => field.startsWith(q))) score = 1;
    else if (fields.some((field) => field.includes(q))) score = 2;
    else if (words.every((word) => haystack.includes(word))) score = 3;
    if (score !== undefined) scored.push({ team, score, index });
  });
  return scored.sort((a, b) => a.score - b.score || a.index - b.index).map(({ team }) => team);
}

/** Whether a ranked match is exact, so a lookup by name can take it without asking. */
export function isExactMatch(team: Pick<Team, 'alias' | 'market' | 'name'>, query: string): boolean {
  const q = fold(query);
  return [team.alias, team.name, team.market, `${team.market} ${team.name}`, displayName(team)].map(fold).includes(q);
}
