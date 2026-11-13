import { StatpadError } from '@statpad/sdk';

import { BudgetExceededError, CALL_TIMEOUT_MS, type CallContext, ToolInputError } from './context.js';

/** The JSON body of an isError tool result. */
export interface ToolErrorBody {
  error: string;
  message: string;
  detail?: string | undefined;
  request_id?: string | undefined;
  retry_after?: number | undefined;
  resets_at?: string | undefined;
  min_seq?: number | undefined;
  [key: string]: unknown;
}

/** Turns anything a tool threw into a message written for the model that called it. */
export function describeError(error: unknown, ctx: CallContext | undefined, league?: string): ToolErrorBody {
  if (error instanceof StatpadError) return describeStatpadError(error, league);
  if (error instanceof ToolInputError) return { error: 'invalid_argument', message: error.message, ...error.details };
  if (error instanceof BudgetExceededError) {
    return {
      error: 'internal',
      message: `statpad-mcp tried to send more than its request budget allows (${error.message}). This is a bug in the server, so report it.`,
    };
  }
  if (ctx?.timedOut) return describeTimeout(ctx);
  if (ctx?.signal.aborted) return { error: 'cancelled', message: 'The client cancelled this call.' };
  if (error instanceof TypeError) {
    return {
      error: 'unavailable',
      message: "statpad-mcp couldn't reach api.statpad.dev. Check the network connection, then try again.",
      detail: error.message,
    };
  }
  return { error: 'internal', message: 'statpad-mcp failed unexpectedly.', detail: error instanceof Error ? error.message : String(error) };
}

function describeStatpadError(error: StatpadError, league: string | undefined): ToolErrorBody {
  const base = { detail: error.detail, request_id: error.requestId };
  switch (error.code) {
    case 'unauthorized':
      return {
        error: 'unauthorized',
        message:
          'Statpad rejected the API key: it is missing, unknown or revoked. Check that STATPAD_API_KEY in the MCP server configuration holds a current key from the Keys page at https://app.statpad.dev. Retrying won\'t help.',
        ...base,
      };
    case 'forbidden':
      return {
        error: 'forbidden',
        message:
          `This key can't read ${league ? `league "${league}"` : 'that'}. The plan may not include it, the account may have no active access, or the alias isn't a league Statpad serves. Call list_leagues for the leagues this key can read.`,
        ...base,
      };
    case 'not_found':
      return {
        error: 'not_found',
        message:
          'Statpad has no such game, team or player in this league. Check that the id came from find_games or find_teams for the same league.',
        ...base,
      };
    case 'rate_limited':
      return {
        error: 'rate_limited',
        message: `The account is sending requests faster than its plan allows, and every key on the account shares that rate. Wait ${seconds(error.retryAfter)} before the next call, then slow down and make fewer calls.`,
        retry_after: error.retryAfter,
        ...base,
      };
    case 'quota_exhausted':
      return {
        error: 'quota_exhausted',
        message: `The account has used this billing period's request allowance${error.resetsAt ? `, which renews at ${error.resetsAt}` : ''}. Don't retry before then. Tell the user, who can upgrade the plan at https://app.statpad.dev.`,
        resets_at: error.resetsAt,
        retry_after: error.retryAfter,
        ...base,
      };
    case 'resync_required':
      return {
        error: 'resync_required',
        message: 'The change feed no longer holds that position. Call get_plays without after_seq and continue from the seq it returns.',
        min_seq: error.minSeq,
        ...base,
      };
    case 'internal':
    case 'unavailable':
      return {
        error: error.code,
        message: 'Statpad had a temporary problem. Try again in a few seconds.',
        retry_after: error.retryAfter,
        ...base,
      };
    case 'bad_request':
      return { error: 'bad_request', message: `Statpad rejected the request: ${error.detail ?? error.title}`, ...base };
    default:
      return { error: error.code ?? `http_${error.status}`, message: `Statpad answered ${error.status}: ${error.detail ?? error.title}`, ...base };
  }
}

function seconds(value: number | undefined): string {
  if (value === undefined) return 'a few seconds';
  return `${value} second${value === 1 ? '' : 's'}`;
}

function describeTimeout(ctx: CallContext): ToolErrorBody {
  const failure = ctx.lastFailure;
  if (failure?.status === 429) {
    return {
      error: 'rate_limited',
      message: `The account is sending requests faster than its plan allows, and Statpad asked to wait ${seconds(failure.retryAfter)}, longer than this tool waits. Every key on the account shares that rate. Wait that long, then slow down and make fewer calls.`,
      retry_after: failure.retryAfter,
      request_id: failure.requestId,
    };
  }
  if (failure && failure.status >= 500) {
    return {
      error: failure.status === 503 ? 'unavailable' : 'internal',
      message: 'Statpad had a temporary problem and the retry ran out of time. Try again in a few seconds.',
      retry_after: failure.retryAfter,
      request_id: failure.requestId,
    };
  }
  return {
    error: 'timeout',
    message: `Statpad didn't answer within ${CALL_TIMEOUT_MS / 1000} seconds. Try again in a few seconds.`,
  };
}
