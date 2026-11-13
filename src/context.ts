import { Statpad } from '@statpad/sdk';

import { formatDuration } from './time.js';

/** The most Statpad requests one tool call may send. */
export const REQUEST_BUDGET = 3;
/** How long one tool call may take, across all of its requests. */
export const CALL_TIMEOUT_MS = 10_000;
/** Below this share of the period allowance, results carry a warning. */
export const LOW_ALLOWANCE_RATIO = 0.05;

export interface ClientConfig {
  apiKey: string;
  baseUrl?: string | undefined;
  fetch?: typeof fetch | undefined;
  userAgent: string;
}

export interface Allowance {
  remaining: number;
  limit?: number | undefined;
  resetSeconds?: number | undefined;
}

/** The last error response seen, kept for when a retry wait outlasts the call's timeout. */
export interface UpstreamFailure {
  status: number;
  retryAfter?: number | undefined;
  requestId?: string | undefined;
}

/** A tool sent more requests than REQUEST_BUDGET allows. This is a bug in the tool. */
export class BudgetExceededError extends Error {
  override readonly name = 'BudgetExceededError';
}

/** The arguments are valid for the schema but can't be served, such as an ambiguous team name. */
export class ToolInputError extends Error {
  override readonly name = 'ToolInputError';
  constructor(
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/**
 * The state of one tool call: its own Statpad client, one abort signal shared by all of its
 * requests, the request counter that enforces the budget, and what the responses said about
 * the account's allowance.
 */
export class CallContext {
  readonly statpad: Statpad;
  readonly signal: AbortSignal;
  readonly now: () => Date;
  requests = 0;
  allowance: Allowance | undefined;
  lastFailure: UpstreamFailure | undefined;
  private readonly timeout: AbortSignal;

  constructor(config: ClientConfig, options: { now: () => Date; signal?: AbortSignal | undefined; timeoutMs?: number | undefined }) {
    this.now = options.now;
    this.timeout = AbortSignal.timeout(options.timeoutMs ?? CALL_TIMEOUT_MS);
    this.signal = options.signal ? anySignal([this.timeout, options.signal]) : this.timeout;
    const send = config.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
    this.statpad = new Statpad({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      maxRetries: 1,
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const headers = new Headers(request.headers);
        headers.set('User-Agent', config.userAgent);
        const response = await send(new Request(request, { headers }));
        this.observe(response);
        return response;
      },
    });
  }

  /** Whether the call's own timeout fired, as opposed to the client cancelling it. */
  get timedOut(): boolean {
    return this.timeout.aborted;
  }

  /** Sends one Statpad request, counted against the budget, with the call's signal. */
  async request<T>(send: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.requests += 1;
    if (this.requests > REQUEST_BUDGET) {
      throw new BudgetExceededError(`a tool call may send at most ${REQUEST_BUDGET} requests to Statpad`);
    }
    return send(this.signal);
  }

  lowAllowanceWarning(): string | undefined {
    const allowance = this.allowance;
    if (!allowance?.limit || allowance.remaining >= allowance.limit * LOW_ALLOWANCE_RATIO) return undefined;
    const resets =
      allowance.resetSeconds === undefined ? '' : `, and it renews in about ${formatDuration(allowance.resetSeconds)}`;
    return (
      `Only ${allowance.remaining} of this billing period's ${allowance.limit} requests remain${resets}. ` +
      'Every key on the account draws from the same allowance, so tell the user and make fewer calls.'
    );
  }

  private observe(response: Response): void {
    const allowance = parseAllowance(response.headers.get('RateLimit'), response.headers.get('RateLimit-Policy'));
    if (allowance) this.allowance = allowance;
    if (response.status < 400) {
      this.lastFailure = undefined;
      return;
    }
    const retryAfter = Number(response.headers.get('Retry-After') ?? Number.NaN);
    this.lastFailure = {
      status: response.status,
      retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined,
      requestId: response.headers.get('X-Request-Id') ?? undefined,
    };
  }
}

/**
 * Reads the `allowance` policy from the RateLimit and RateLimit-Policy headers, which are
 * Structured Field lists such as `"allowance";r=499120;t=1723456`. Unknown members and
 * parameters are ignored.
 */
export function parseAllowance(rateLimit: string | null, policy: string | null): Allowance | undefined {
  const state = allowanceParams(rateLimit);
  const remaining = integer(state?.get('r'));
  if (remaining === undefined) return undefined;
  return {
    remaining,
    limit: integer(allowanceParams(policy)?.get('q')),
    resetSeconds: integer(state?.get('t')),
  };
}

function allowanceParams(header: string | null): Map<string, string> | undefined {
  if (!header) return undefined;
  for (const member of header.split(',')) {
    const [item, ...params] = member.trim().split(';');
    if (item?.trim().replace(/^"(.*)"$/, '$1') !== 'allowance') continue;
    return new Map(
      params.map((param) => {
        const at = param.indexOf('=');
        return at < 0 ? [param.trim(), ''] : [param.slice(0, at).trim(), param.slice(at + 1).trim()];
      }),
    );
  }
  return undefined;
}

function integer(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  return Number(value);
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals);
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}
