import { McpServer } from '@modelcontextprotocol/server';

import { CallContext } from './context.js';
import { describeError } from './errors.js';
import { type Logger, silentLogger } from './log.js';
import { dropNulls, estimateTokens } from './output.js';
import type { Tool } from './tools/common.js';
import { TOOLS } from './tools/index.js';
import { VERSION } from './version.js';

export interface StatpadMcpOptions {
  /** A Statpad API key. It is sent only to the API, never logged or returned. */
  apiKey: string;
  /** @default 'https://api.statpad.dev' */
  baseUrl?: string | undefined;
  /** The fetch the Statpad client uses, for tests and proxies. */
  fetch?: typeof fetch | undefined;
  /** The clock that resolves today, yesterday and tomorrow. */
  now?: () => Date;
  logger?: Logger;
  /** Names the entry point in the User-Agent header, such as stdio. */
  transport?: string;
  /** How long one tool call may take. @default 10000 */
  timeoutMs?: number;
}

export const INSTRUCTIONS = `Statpad is a live sports data API. These tools read its schedules, live game state, play-by-play, drives and box scores. Every tool is read-only.

Coverage. Call list_leagues for the leagues this key can read. That list is the only source of truth for coverage, so don't assume a league exists because it is well known. Collection started in November 2026, so there are no earlier games or seasons.

Not available. Say so plainly instead of guessing or using memory: standings, injuries, transactions, depth charts, team rosters, betting odds, season stats and leaders, player profiles and player search. Box scores have player lines only, with no team totals and no score by period. If you add up player lines for a team total, say that you did.

Workflow. find_games returns game ids, and find_teams returns team ids. With a game id, get_game gives the score and live situation, get_plays the recent or scoring plays and the drives, and get_box_score the player stats.

Dates and times. find_games reads date as a schedule day in tz, which defaults to America/New_York, and resolves today, yesterday and tomorrow in that zone. Timestamps in results are UTC unless the field is local_time. Statpad lists a game about 10 minutes before kickoff, so a future day usually comes back empty, which doesn't mean nothing is scheduled.

Freshness. The data is live and changes during a game, and stats can be corrected after the final whistle. When you report a live situation, give live_state.updated_at as its time. To follow a game, pass the seq of a result to get_plays as after_seq.

Limits. Each tool call sends at most 3 requests to Statpad. Every key on the account shares one request rate and one monthly allowance, including the account's production apps, so don't poll in a tight loop. If a result has a warning field, pass it on to the user.`;

/**
 * Builds an MCP server with the Statpad tools. It knows nothing about its transport, so the
 * stdio entry and a future HTTP entry, such as a Cloudflare Worker, share it as their factory.
 */
export function createStatpadMcpServer(options: StatpadMcpOptions): McpServer {
  const server = new McpServer({ name: 'statpad', title: 'Statpad', version: VERSION }, { instructions: INSTRUCTIONS });
  for (const tool of TOOLS) registerTool(server, tool, options);
  return server;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function registerTool(server: McpServer, tool: Tool<any, any>, options: StatpadMcpOptions): void {
  const log = options.logger ?? silentLogger;
  const config = {
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    fetch: options.fetch,
    userAgent: `statpad-mcp/${VERSION} (${options.transport ?? 'stdio'})`,
  };
  const redact = (text: string) => (options.apiKey ? text.split(options.apiKey).join('[redacted]') : text);

  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.input,
      outputSchema: tool.output,
      annotations: { title: tool.title, readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args: Record<string, unknown>, extra: { mcpReq: { signal: AbortSignal } }) => {
      const started = Date.now();
      const ctx = new CallContext(config, {
        now: options.now ?? (() => new Date()),
        signal: extra.mcpReq.signal,
        timeoutMs: options.timeoutMs,
      });
      try {
        const output = await tool.run(args, ctx);
        const warning = ctx.lowAllowanceWarning();
        const text = redact(JSON.stringify(dropNulls(warning ? { ...output, warning } : output)));
        log('info', 'tool call', { tool: tool.name, requests: ctx.requests, ms: Date.now() - started, tokens: estimateTokens(text) });
        return { content: [{ type: 'text' as const, text }], structuredContent: JSON.parse(text) as Record<string, unknown> };
      } catch (error) {
        const body = describeError(error, ctx, typeof args.league === 'string' ? args.league : undefined);
        const text = redact(JSON.stringify(dropNulls(body)));
        log('warn', 'tool error', { tool: tool.name, requests: ctx.requests, ms: Date.now() - started, error: body.error, request_id: body.request_id });
        return { content: [{ type: 'text' as const, text }], isError: true };
      }
    },
  );
}
